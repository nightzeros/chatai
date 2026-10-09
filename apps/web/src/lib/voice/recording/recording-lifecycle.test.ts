import { mkdtempSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assistants,
  conversations,
  eq,
  messages,
  resolveEffectiveVoicePersistence,
  user,
  voiceEvents,
  voiceRecordings,
  voiceSessions,
  type Database,
  type PrivacySettings,
  type VoiceSettings,
} from "@chatai/database";
import { createTestDatabase } from "@chatai/database/testing";
import { MockRealtimeVoiceProvider, type MockControlChannel } from "@chatai/voice/mock";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown,
  session: null as { user: { id: string } } | null,
}));

vi.mock("@/lib/db", () => ({ db: () => state.db }));
vi.mock("@/lib/session", () => ({ getSession: async () => state.session }));
vi.mock("@/lib/env", async () => {
  const { mkdtempSync: mk } = await import("node:fs");
  const { tmpdir: tmp } = await import("node:os");
  const { join } = await import("node:path");
  return {
    env: {
      DATABASE_URL: "postgres://unused",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
      VOICE_RECORDING_SPOOL_DIR: mk(join(tmp(), "chatai-rec-spool-")),
      VOICE_PROVIDER: "mock",
    },
  };
});

import { createMemoryObjectStorage, type MemoryObjectStorage } from "@/lib/storage/memory";
import { setObjectStorageForTests } from "@/lib/storage/object-storage";
import { loadRecentConversationHistory } from "@/lib/conversation-history";
import { deleteOwnedConversation } from "@/lib/privacy/conversation-lifecycle";
import { createId } from "@/lib/ids";

import { fakeVoiceRuntime } from "../__fixtures__/runtime";
import { terminateVoiceSession } from "../lifecycle";
import { createVoiceConversation, insertDurableVoiceSessionRow } from "../persist";
import type { VoiceRuntimeSession } from "../session-runtime";
import { superviseSideband } from "../sideband-supervisor";
import { deleteAssistantRecordingObjects, runRecordingMaintenance } from "./cleanup";
import { recordingCardState } from "./card-state";
import { VoiceSessionRecorder } from "./recorder";
import {
  activeRecordingIds,
  publishSpooledRecording,
  recordingPreSkip,
  recordingSpoolPath,
  recordingStorageKey,
  setRecordingUploadDelaysForTests,
  startVoiceRecording,
} from "./service";
import { listConversationRecordings, toVoiceRecordingView } from "./playback";
import { GET as getRecording } from "@/app/api/assistants/[id]/voice-recordings/[recordingId]/route";
import { GET as streamRecording } from "@/app/api/assistants/[id]/voice-recordings/[recordingId]/stream/route";

const SECRET_PHRASE = "my account number is 4417-9921";
const RATE = 24_000;

let db: Database;
let close: () => Promise<void>;
let storage: MemoryObjectStorage;
let seq = 0;

function tone(freq: number, ms: number, amplitude = 8000): Int16Array {
  const out = new Int16Array(Math.round((RATE * ms) / 1000));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / RATE));
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seedAssistant(
  voiceSettings: VoiceSettings,
  privacySettings: PrivacySettings = { storeConversations: true },
) {
  seq += 1;
  const userId = `user_${seq}`;
  const assistantId = `asst_${seq}`;
  await db.insert(user).values({ id: userId, name: "Owner", email: `owner${seq}@example.com` });
  await db.insert(assistants).values({
    id: assistantId,
    publicId: `pub_${seq}`,
    userId,
    name: "Voice Bot",
    privacySettings,
    voiceSettings,
  });
  return { userId, assistantId, voiceSettings, privacySettings };
}

async function startSession(
  seed: Awaited<ReturnType<typeof seedAssistant>>,
): Promise<{ runtime: VoiceRuntimeSession; channel: MockControlChannel; recorded: boolean }> {
  const provider = new MockRealtimeVoiceProvider();
  const created = await provider.createWebRtcSession({
    sdpOffer: "v=0\r\n",
    sessionConfig: {
      model: "gpt-live-1",
      voice: "marin",
      delegationMode: "client",
    } as Parameters<typeof provider.createWebRtcSession>[0]["sessionConfig"],
  });
  const channel = (await provider.attachControlChannel(created.providerSessionId)) as MockControlChannel;
  const persistence = resolveEffectiveVoicePersistence(seed.privacySettings, seed.voiceSettings);
  const conversationId = persistence.ephemeral
    ? null
    : await createVoiceConversation({ assistantId: seed.assistantId, visitorId: "visitor01", source: "widget" });
  const runtime = fakeVoiceRuntime({
    sessionId: createId(),
    providerSessionId: created.providerSessionId,
    assistantId: seed.assistantId,
    source: "widget",
    visitorId: "visitor01",
    ephemeral: persistence.ephemeral,
    persistence,
    conversationId,
    channel,
    provider,
    status: "connecting",
    recordingConsentAt: new Date(),
    recordingRetentionDays: "off",
  });
  superviseSideband(runtime, channel);
  await insertDurableVoiceSessionRow(runtime);
  const recorded = await startVoiceRecording(runtime);
  return { runtime, channel, recorded };
}

/** ~1.2 s of real-time conversation: visitor speaks, assistant answers (GPT-Live itself). */
async function talk(channel: MockControlChannel) {
  for (let i = 0; i < 6; i += 1) {
    channel.simulateInputAudio(tone(440, 100));
    await sleep(100);
  }
  channel.simulateInputTranscript(SECRET_PHRASE);
  channel.simulateOutputAudio(tone(660, 500), 650);
  channel.simulateOutputTranscript(`Thanks, I noted ${SECRET_PHRASE}.`);
  await sleep(700);
}

async function waitForFinalize() {
  await vi.waitFor(() => expect(activeRecordingIds().size).toBe(0), { timeout: 15_000, interval: 50 });
}

async function recordingRows(sessionId: string) {
  return db.select().from(voiceRecordings).where(eq(voiceRecordings.sessionId, sessionId));
}

function routeContext(assistantId: string, recordingId: string) {
  return { params: Promise.resolve({ id: assistantId, recordingId }) };
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
}, 60_000);

afterAll(async () => {
  setObjectStorageForTests(undefined);
  setRecordingUploadDelaysForTests(null);
  await close();
});

beforeEach(() => {
  storage = createMemoryObjectStorage();
  setObjectStorageForTests(storage);
  setRecordingUploadDelaysForTests([0, 0, 0]);
  state.session = null;
});

describe("Voice recording lifecycle (PGlite + in-memory object storage)", () => {
  it("privacy: storage ON + recording ON + transcripts OFF + consent → audio stored and playable, transcript never persisted", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: false, saveAudioRecordings: true });
    const { runtime, channel, recorded } = await startSession(seed);
    expect(recorded).toBe(true);
    const conversationId = runtime.conversationId!;
    expect(conversationId).toBeTruthy();

    await talk(channel);
    const ended = await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    expect(ended.ephemeral).toBe(false);
    await waitForFinalize();

    // Audio: one ready recording with a real WebM object.
    const [row] = await recordingRows(runtime.sessionId);
    expect(row).toMatchObject({ status: "ready", partial: false, kind: "mix", contentType: "audio/webm" });
    expect(row!.storageKey).toBe(recordingStorageKey(seed.assistantId, row!.id));
    expect(row!.byteSize).toBeGreaterThan(500);
    expect(row!.durationMs).toBeGreaterThan(900);
    const object = storage.objects.get(row!.storageKey!);
    expect(object?.bytes.slice(0, 4)).toEqual(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
    await expect(stat(recordingSpoolPath(row!.id))).rejects.toThrow();

    // Transcript: no Voice messages, nothing becomes later text/Voice context.
    const stored = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    expect(stored).toHaveLength(0);
    expect(await loadRecentConversationHistory(conversationId)).toEqual([]);
    const events = await db.select().from(voiceEvents).where(eq(voiceEvents.sessionId, runtime.sessionId));
    expect(JSON.stringify(events)).not.toContain("4417");

    // Recording metadata carries no transcript content.
    expect(JSON.stringify(row)).not.toContain("4417");
    const [sessionRow] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, runtime.sessionId));
    expect(sessionRow!.recordingConsentAt).toBeInstanceOf(Date);
    expect(JSON.stringify(sessionRow)).not.toContain("4417");

    // Owner can play it back through the authenticated proxy.
    state.session = { user: { id: seed.userId } };
    const meta = await getRecording(new Request("http://x"), routeContext(seed.assistantId, row!.id));
    const body = (await meta.json()) as { recording: { status: string }; playback: { url: string } };
    expect(meta.status).toBe(200);
    expect(body.recording.status).toBe("ready");
    expect(JSON.stringify(body)).not.toContain(row!.storageKey!);
    const audio = await streamRecording(
      new Request(`http://localhost${body.playback.url}`),
      routeContext(seed.assistantId, row!.id),
    );
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/webm");
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(object!.bytes);
  }, 30_000);

  it("control: with transcripts ON the same conversation does persist Voice messages", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: true, saveAudioRecordings: true });
    const { runtime, channel } = await startSession(seed);
    await talk(channel);
    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    await waitForFinalize();
    const stored = await db.select().from(messages).where(eq(messages.conversationId, runtime.conversationId!));
    expect(stored.map((m) => m.content).join(" ")).toContain("4417");
    const [row] = await recordingRows(runtime.sessionId);
    expect(row?.status).toBe("ready");
    expect(JSON.stringify(row)).not.toContain("4417");
  }, 30_000);

  it("timeline V2: new recordings are version 2 and stored turn offsets use detected audio onsets", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: true, saveAudioRecordings: true });
    const { runtime, channel } = await startSession(seed);
    expect(runtime.recording!.recorder.timelineVersion).toBe(2);
    expect(runtime.turnOffsets).toBeTruthy();

    // Visitor speaks 300–900 ms; the transcript stamp trails by 580 ms (880 ms).
    channel.simulateInputAudio(new Int16Array((RATE * 300) / 1000));
    channel.simulateInputAudio(tone(440, 600));
    channel.advanceTimeline(880);
    // A social turn, so the turn gate lets the live "Noted." through as heard speech.
    channel.simulateInputTranscript("Thank you", 400);
    channel.simulateInputAudio(new Int16Array((RATE * 1_300) / 1000));
    // Assistant transcript at 1280 ms leads its audio (1660 ms) by 380 ms.
    channel.simulateOutputTranscript("Noted.", 400);
    channel.simulateOutputAudio(new Int16Array(RATE / 50), 1_640);
    channel.simulateOutputAudio(tone(660, 500), 1_660);
    await sleep(50);

    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    await waitForFinalize();
    const [row] = await recordingRows(runtime.sessionId);
    expect(row).toMatchObject({ status: "ready", partial: false, timelineVersion: 2 });
    expect(toVoiceRecordingView(row!)!.timelineVersion).toBe(2);

    const stored = await db
      .select({ role: messages.role, audioOffsetMs: messages.audioOffsetMs })
      .from(messages)
      .where(eq(messages.conversationId, runtime.conversationId!));
    // V1 would have stored the raw stamps (880 / 1280).
    expect(stored).toEqual([
      { role: "user", audioOffsetMs: 300 },
      { role: "assistant", audioOffsetMs: 1_660 },
    ]);
    expect(runtime.turnOffsets!.stats).toEqual({
      visitorOnset: 1,
      visitorFallback: 0,
      assistantOnset: 1,
      assistantFallback: 0,
    });
  }, 30_000);

  it("timeline V2: a sideband re-attach during a recorded call places the backlog and completes the recording", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: false, saveAudioRecordings: true });
    const { runtime, channel } = await startSession(seed);
    const recorder = runtime.recording!.recorder;
    channel.simulateInputAudio(new Int16Array((RATE * 300) / 1000));
    channel.simulateInputAudio(tone(440, 600));

    channel.simulateSidebandDrop();
    await vi.waitFor(() => expect(channel.isConnected()).toBe(true), { timeout: 5_000, interval: 20 });
    // Backlog replayed on re-attach: 1 s of visitor audio ending at provider time 3 s.
    channel.simulateInputAudio(tone(440, 1_000));
    channel.advanceTimeline(2_500);
    channel.simulateInputTranscript("hello again", 500);
    await sleep(800);
    channel.simulateInputAudio(new Int16Array(RATE / 10));

    expect(recorder.timelineStats).toMatchObject({ anchoredReleases: 1, reanchoredMs: 1_100 });
    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    await waitForFinalize();
    const [row] = await recordingRows(runtime.sessionId);
    expect(row).toMatchObject({ status: "ready", partial: false, timelineVersion: 2 });
    expect(row!.durationMs).toBeGreaterThanOrEqual(3_000);
  }, 30_000);

  it("gating: no recording without object storage, under no-store, or with recording off", async () => {
    setObjectStorageForTests(null);
    const noStorage = await startSession(
      await seedAssistant({ enabled: true, saveTranscripts: true, saveAudioRecordings: true }),
    );
    expect(noStorage.recorded).toBe(false);

    setObjectStorageForTests(storage);
    const noStore = await startSession(
      await seedAssistant(
        { enabled: true, saveTranscripts: true, saveAudioRecordings: true },
        { storeConversations: false },
      ),
    );
    expect(noStore.recorded).toBe(false);
    expect(noStore.runtime.conversationId).toBeNull();

    const off = await startSession(await seedAssistant({ enabled: true, saveTranscripts: true }));
    expect(off.recorded).toBe(false);

    for (const s of [noStorage, noStore, off]) {
      expect(await recordingRows(s.runtime.sessionId)).toHaveLength(0);
      // Without a V2 recording there is no onset resolver.
      expect(s.runtime.turnOffsets ?? null).toBeNull();
      await terminateVoiceSession(s.runtime, { reason: "close_requested", requestProviderClose: true });
    }
    expect(storage.objects.size).toBe(0);
  }, 30_000);

  it("upload failure never fails the Voice session: row marked failed, local files removed", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: false, saveAudioRecordings: true });
    const { runtime, channel } = await startSession(seed);
    storage.failPut = 10;
    await talk(channel);
    const ended = await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    expect(ended.status).toBe("ended");
    await waitForFinalize();
    const [row] = await recordingRows(runtime.sessionId);
    expect(row).toMatchObject({ status: "failed", errorCode: "recording_upload_failed" });
    expect(storage.objects.size).toBe(0);
    await expect(stat(recordingSpoolPath(row!.id))).rejects.toThrow();
    expect(recordingCardState(toVoiceRecordingView(row!)!).message).toBe(
      "Recording could not be saved. The Voice conversation itself was not affected.",
    );
  }, 30_000);

  it("a session with no media connected leaves no recording row", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: false, saveAudioRecordings: true });
    const { runtime } = await startSession(seed);
    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    await waitForFinalize();
    expect(await recordingRows(runtime.sessionId)).toHaveLength(0);
  }, 30_000);

  it("conversation deleted during upload: the uploaded object is removed, nothing is resurrected", async () => {
    const seed = await seedAssistant({ enabled: true, saveTranscripts: false, saveAudioRecordings: true });
    const { runtime, channel } = await startSession(seed);
    const conversationId = runtime.conversationId!;
    const put = storage.putFile.bind(storage);
    storage.putFile = async (key, file, opts) => {
      const result = await put(key, file, opts);
      expect(await deleteOwnedConversation(seed.userId, seed.assistantId, conversationId)).toEqual({ ok: true });
      return result;
    };
    await talk(channel);
    await terminateVoiceSession(runtime, { reason: "close_requested", requestProviderClose: true });
    await waitForFinalize();
    expect(storage.objects.size).toBe(0);
    expect(await recordingRows(runtime.sessionId)).toHaveLength(0);
  }, 30_000);

  async function spoolWithAudio(recordingId: string, ms = 1000, timelineVersion: 1 | 2 = 1) {
    let now = 0;
    const recorder = await VoiceSessionRecorder.start(recordingSpoolPath(recordingId), {
      now: () => now,
      autoTick: false,
      timelineVersion,
    });
    for (let t = 0; t < ms; t += 100) {
      now = t + 100;
      recorder.onAudio({ source: "input", pcm: tone(440, 100) });
      recorder.tick();
    }
    now += 2000;
    const stopped = await recorder.stop();
    expect(stopped.ok).toBe(true);
  }

  async function insertRecording(input: {
    seed: Awaited<ReturnType<typeof seedAssistant>>;
    status?: "pending" | "ready";
    createdAt?: Date;
    expiresAt?: Date | null;
    withObject?: boolean;
    timelineVersion?: number;
  }) {
    const conversationId = await createVoiceConversation({
      assistantId: input.seed.assistantId,
      visitorId: null,
      source: "widget",
    });
    const sessionId = createId();
    await db.insert(voiceSessions).values({
      id: sessionId,
      assistantId: input.seed.assistantId,
      conversationId,
      source: "widget",
      provider: "mock",
      status: "ended",
      ephemeral: false,
      model: "gpt-live-1",
      voiceId: "marin",
      startedAt: new Date(),
    });
    const id = createId();
    const storageKey = recordingStorageKey(input.seed.assistantId, id);
    await db.insert(voiceRecordings).values({
      id,
      sessionId,
      conversationId,
      kind: "mix",
      status: input.status ?? "ready",
      storageKey,
      contentType: "audio/webm",
      startMs: 0,
      byteSize: 4,
      durationMs: 1000,
      expiresAt: input.expiresAt ?? null,
      createdAt: input.createdAt ?? new Date(),
      ...(input.timelineVersion ? { timelineVersion: input.timelineVersion } : {}),
    });
    if (input.withObject !== false) {
      const file = path.join(mkdtempSync(path.join(tmpdir(), "rec-")), "obj.webm");
      await writeFile(file, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]));
      await storage.putFile(storageKey, file, { contentType: "audio/webm" });
    }
    return { id, storageKey, conversationId, sessionId };
  }

  it("crash sweep: a pending recording with a spool is published as partial; without one it fails", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true, recordingRetentionDays: 30 });
    const old = new Date(Date.now() - 5 * 60_000);
    const withSpool = await insertRecording({ seed, status: "pending", createdAt: old, withObject: false });
    const withoutSpool = await insertRecording({ seed, status: "pending", createdAt: old, withObject: false });
    const fresh = await insertRecording({ seed, status: "pending", withObject: false });
    await spoolWithAudio(withSpool.id);

    const result = await runRecordingMaintenance();
    expect(result.recovered).toBe(1);
    expect(result.failed).toBe(1);

    const [recovered] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, withSpool.id));
    expect(recovered).toMatchObject({ status: "ready", partial: true });
    expect(recovered!.durationMs).toBeGreaterThan(800);
    expect(recovered!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(storage.objects.get(withSpool.storageKey)?.bytes.byteLength).toBeGreaterThan(100);
    await expect(stat(recordingSpoolPath(withSpool.id))).rejects.toThrow();
    expect(recordingCardState(toVoiceRecordingView(recovered!)!).message).toContain(
      "Recording ended unexpectedly; saved up to the interruption.",
    );

    const [failed] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, withoutSpool.id));
    expect(failed).toMatchObject({ status: "failed", errorCode: "recording_interrupted" });
    const [untouched] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, fresh.id));
    expect(untouched?.status).toBe("pending");
  }, 30_000);

  it("crash sweep: a V2 spool is published as partial and keeps timeline version 2; old rows stay V1", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
    const old = new Date(Date.now() - 5 * 60_000);
    const v2 = await insertRecording({ seed, status: "pending", createdAt: old, withObject: false, timelineVersion: 2 });
    const legacy = await insertRecording({ seed });
    await spoolWithAudio(v2.id, 1000, 2);

    expect((await runRecordingMaintenance()).recovered).toBe(1);
    const [recovered] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, v2.id));
    expect(recovered).toMatchObject({ status: "ready", partial: true, timelineVersion: 2 });
    expect(recovered!.durationMs).toBeGreaterThan(800);
    expect(toVoiceRecordingView(recovered!)!.timelineVersion).toBe(2);

    const [v1] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, legacy.id));
    expect(v1!.timelineVersion).toBe(1);
    expect(toVoiceRecordingView(v1!)!.timelineVersion).toBe(1);
  }, 30_000);

  it("a recording whose row was already deleted is discarded without uploading", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
    const rec = await insertRecording({ seed, status: "pending", withObject: false });
    await spoolWithAudio(rec.id);
    await db.delete(voiceRecordings).where(eq(voiceRecordings.id, rec.id));
    const result = await publishSpooledRecording({
      recordingId: rec.id,
      storageKey: rec.storageKey,
      spoolPath: recordingSpoolPath(rec.id),
      preSkip: await recordingPreSkip(),
      partial: false,
      retentionDays: "off",
    });
    expect(result).toBe("discarded");
    expect(storage.objects.size).toBe(0);
    await expect(stat(recordingSpoolPath(rec.id))).rejects.toThrow();
  });

  it("recovered spools reuse the live encoder's pre-skip", async () => {
    const { StereoOpusEncoder } = await import("./codec");
    const encoder = await StereoOpusEncoder.create();
    expect(await recordingPreSkip()).toBe(encoder.preSkip);
    encoder.free();
  });

  it("conversation deletion removes the object before the row; a failed delete is retried", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
    const ok = await insertRecording({ seed });
    expect(await deleteOwnedConversation(seed.userId, seed.assistantId, ok.conversationId)).toEqual({ ok: true });
    expect(storage.objects.has(ok.storageKey)).toBe(false);
    expect(await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, ok.id))).toHaveLength(0);

    const flaky = await insertRecording({ seed });
    storage.failDelete = 1;
    expect(await deleteOwnedConversation(seed.userId, seed.assistantId, flaky.conversationId)).toEqual({ ok: true });
    // Conversation is gone regardless; the row stays detached until storage recovers.
    expect(await db.select().from(conversations).where(eq(conversations.id, flaky.conversationId))).toHaveLength(0);
    const [detached] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, flaky.id));
    expect(detached).toMatchObject({ status: "deleting", conversationId: null });
    expect(storage.objects.has(flaky.storageKey)).toBe(true);
    expect(toVoiceRecordingView(detached!)).toBeNull();

    const result = await runRecordingMaintenance();
    expect(result.deleted).toBe(1);
    expect(storage.objects.has(flaky.storageKey)).toBe(false);
    expect(await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, flaky.id))).toHaveLength(0);
  });

  it("assistant deletion aborts while any object delete fails, and removes every object when storage works", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
    const a = await insertRecording({ seed });
    const b = await insertRecording({ seed });
    storage.failDelete = 1;
    expect(await deleteAssistantRecordingObjects(seed.assistantId)).toBe(false);
    expect(storage.objects.has(a.storageKey) || storage.objects.has(b.storageKey)).toBe(true);

    expect(await deleteAssistantRecordingObjects(seed.assistantId)).toBe(true);
    expect(storage.objects.has(a.storageKey)).toBe(false);
    expect(storage.objects.has(b.storageKey)).toBe(false);
    await db.delete(assistants).where(eq(assistants.id, seed.assistantId));
    expect(await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, a.id))).toHaveLength(0);
  });

  it("retention deletes the object and leaves an expired tombstone the owner can see", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
    const due = await insertRecording({ seed, expiresAt: new Date(Date.now() - 1000) });
    const later = await insertRecording({ seed, expiresAt: new Date(Date.now() + 86_400_000) });
    const result = await runRecordingMaintenance();
    expect(result.expired).toBe(1);
    expect(storage.objects.has(due.storageKey)).toBe(false);
    expect(storage.objects.has(later.storageKey)).toBe(true);

    const [tombstone] = await listConversationRecordings(due.conversationId);
    expect(tombstone).toMatchObject({ status: "expired" });
    expect(tombstone!.deletedAt).toBeTruthy();
    expect(recordingCardState(tombstone!).playable).toBe(false);
    expect(recordingCardState(tombstone!).message).toMatch(/^Recording deleted on .+ by the retention setting\.$/);

    state.session = { user: { id: seed.userId } };
    const meta = await getRecording(new Request("http://x"), routeContext(seed.assistantId, due.id));
    expect(((await meta.json()) as { playback: unknown }).playback).toBeNull();
  });

  it("stray spool files for finished recordings are removed", async () => {
    const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
    const done = await insertRecording({ seed });
    await spoolWithAudio(done.id, 200);
    const result = await runRecordingMaintenance(new Date(Date.now() + 5 * 60_000));
    expect(result.spoolsRemoved).toBeGreaterThanOrEqual(1);
    await expect(stat(recordingSpoolPath(done.id))).rejects.toThrow();
  });

  describe("playback proxy", () => {
    async function playable() {
      const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
      const rec = await insertRecording({ seed });
      state.session = { user: { id: seed.userId } };
      const meta = await getRecording(new Request("http://x"), routeContext(seed.assistantId, rec.id));
      const { playback } = (await meta.json()) as { playback: { url: string; expiresAt: string } };
      return { seed, rec, url: `http://localhost${playback.url}` };
    }

    it("serves byte ranges with private, no-store headers", async () => {
      const { seed, rec, url } = await playable();
      const ranged = await streamRecording(
        new Request(url, { headers: { range: "bytes=1-2" } }),
        routeContext(seed.assistantId, rec.id),
      );
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe("bytes 1-2/4");
      expect(ranged.headers.get("cache-control")).toBe("private, no-store");
      expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(new Uint8Array([0x45, 0xdf]));

      const suffix = await streamRecording(
        new Request(url, { headers: { range: "bytes=-1" } }),
        routeContext(seed.assistantId, rec.id),
      );
      expect(suffix.status).toBe(206);
      expect(suffix.headers.get("content-range")).toBe("bytes 3-3/4");

      const bad = await streamRecording(
        new Request(url, { headers: { range: "bytes=10-" } }),
        routeContext(seed.assistantId, rec.id),
      );
      expect(bad.status).toBe(416);
    });

    it("requires the signed-in owner and a valid token for this recording", async () => {
      const { seed, rec, url } = await playable();

      state.session = null;
      expect((await streamRecording(new Request(url), routeContext(seed.assistantId, rec.id))).status).toBe(401);

      // Another signed-in user with the copied URL.
      state.session = { user: { id: "someone_else" } };
      expect((await streamRecording(new Request(url), routeContext(seed.assistantId, rec.id))).status).toBe(403);
      expect(
        (await getRecording(new Request("http://x"), routeContext(seed.assistantId, rec.id))).status,
      ).toBe(404);

      state.session = { user: { id: seed.userId } };
      const noToken = url.replace(/token=[^&]+/, "token=");
      expect((await streamRecording(new Request(noToken), routeContext(seed.assistantId, rec.id))).status).toBe(403);
      const tampered = url.replace(/token=([^&]+)/, (_m, t: string) => `token=${t.slice(0, -2)}xx`);
      expect((await streamRecording(new Request(tampered), routeContext(seed.assistantId, rec.id))).status).toBe(403);

      // Token for a different recording.
      const other = await insertRecording({ seed });
      expect((await streamRecording(new Request(url), routeContext(seed.assistantId, other.id))).status).toBe(403);
    });

    it("expires tokens after 10 minutes", async () => {
      const { seed, rec, url } = await playable();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(Date.now() + 11 * 60_000);
        const response = await streamRecording(new Request(url), routeContext(seed.assistantId, rec.id));
        expect(response.status).toBe(403);
        expect(((await response.json()) as { error: string }).error).toBe("Playback link expired.");
      } finally {
        vi.useRealTimers();
      }
    });

    it("pending and failed recordings have no playback URL", async () => {
      const seed = await seedAssistant({ enabled: true, saveAudioRecordings: true });
      const pending = await insertRecording({ seed, status: "pending", withObject: false });
      state.session = { user: { id: seed.userId } };
      const meta = await getRecording(new Request("http://x"), routeContext(seed.assistantId, pending.id));
      const body = (await meta.json()) as { recording: { status: string }; playback: unknown };
      expect(body.recording.status).toBe("pending");
      expect(body.playback).toBeNull();
    });

    it("returns 404 when the object has vanished and 503 when storage is unconfigured", async () => {
      const { seed, rec, url } = await playable();
      storage.objects.delete(rec.storageKey);
      expect((await streamRecording(new Request(url), routeContext(seed.assistantId, rec.id))).status).toBe(404);
      setObjectStorageForTests(null);
      expect((await streamRecording(new Request(url), routeContext(seed.assistantId, rec.id))).status).toBe(503);
    });
  });
});
