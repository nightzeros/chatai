import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assistants,
  eq,
  hostingAccounts,
  messages,
  resolveEffectiveVoicePersistence,
  usageEvents,
  usagePeriodBalances,
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  db: null as unknown,
  env: {
    DATABASE_URL: "postgres://unused",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
    VOICE_PROVIDER: "mock",
    VOICE_RECORDING_SPOOL_DIR: "",
    HOSTED_USAGE_ENFORCEMENT: "enforce" as const,
    HOSTED_USAGE_DEFAULT_LIMIT_MICROS: 5_000_000,
    HOSTED_USAGE_RECONCILE_STALE_MINUTES: 15,
    VOICE_QUOTA_EXEMPT_PLAYGROUND: true,
    VOICE_MAX_CONCURRENT_SESSIONS: undefined as number | undefined,
  },
}));

vi.mock("@/lib/db", () => ({ db: () => state.db }));
vi.mock("@/lib/session", () => ({ getSession: async () => null }));
vi.mock("@/lib/env", () => ({ env: state.env }));
vi.mock("@/lib/cors", () => ({
  corsHeaders: { "Access-Control-Allow-Origin": "*" },
  jsonWithCors: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    Response.json(body, { status: init?.status ?? 200, headers: init?.headers }),
}));

import { POST as heartbeatPOST } from "@/app/api/v1/voice/sessions/[sessionId]/heartbeat/route";
import { getOrCreateUsagePeriodBalance } from "@/lib/hosting/period-balance";
import { createId } from "@/lib/ids";
import { createMemoryObjectStorage } from "@/lib/storage/memory";
import { setObjectStorageForTests } from "@/lib/storage/object-storage";

import { fakeVoiceRuntime } from "./__fixtures__/runtime";
import { createVoiceControlToken } from "./control-token";
import { createVoiceMeter, setVoiceMeterAutoTickForTests } from "./enforcement";
import { clearEndedVoiceSessionsForTests, getEndedVoiceSession, publicEndResult } from "./lifecycle";
import { markVoiceProviderCreated } from "./metering";
import { createVoiceConversation, insertDurableVoiceSessionRow, insertOperationalVoiceSessionRow } from "./persist";
import { admitVoiceSession } from "./quota";
import { runRecordingMaintenance } from "./recording/cleanup";
import {
  activeRecordingIds,
  pendingRecordingFinalizations,
  recordingSpoolPath,
  setRecordingUploadDelaysForTests,
  startVoiceRecording,
} from "./recording/service";
import {
  clearVoiceRuntimeForTests,
  getVoiceRuntime,
  listVoiceRuntimes,
  registerVoiceRuntime,
  type VoiceRuntimeSession,
} from "./session-runtime";
import {
  drainVoiceRuntime,
  installVoiceShutdownHandlers,
  isVoiceDraining,
  resetVoiceShutdownForTests,
  type VoiceDrainReport,
} from "./shutdown";
import { superviseSideband } from "./sideband-supervisor";

const SECRET_PHRASE = "my account number is 4417-9921";
const RATE = 24_000;

let db: Database;
let close: () => Promise<void>;
let seq = 0;

function tone(freq: number, ms: number, amplitude = 8000): Int16Array {
  const out = new Int16Array(Math.round((RATE * ms) / 1000));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * freq * i) / RATE));
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(opts: { privacy?: PrivacySettings; voice?: VoiceSettings } = {}) {
  const n = (seq += 1);
  const userId = `user_sd_${n}`;
  const accountId = `acct_sd_${n}`;
  const assistantId = `asst_sd_${n}`;
  const privacySettings = opts.privacy ?? { storeConversations: true };
  const voiceSettings = opts.voice ?? { enabled: true, saveTranscripts: true };
  await db.insert(user).values({ id: userId, name: "Owner", email: `sd${n}@example.com` });
  await db.insert(hostingAccounts).values({
    id: accountId,
    userId,
    planCode: "pro",
    periodAnchor: new Date("2026-01-01T00:00:00Z"),
  });
  await db.insert(assistants).values({
    id: assistantId,
    publicId: `pub_sd_${n}`,
    userId,
    name: "Voice Bot",
    privacySettings,
    voiceSettings,
  });
  const [account] = await db.select().from(hostingAccounts).where(eq(hostingAccounts.id, accountId));
  const balance = await getOrCreateUsagePeriodBalance(account!);
  await db
    .update(usagePeriodBalances)
    .set({ voiceSecondsLimit: 3_600, voiceSecondsConsumed: 0, voiceSecondsReserved: 0 })
    .where(eq(usagePeriodBalances.id, balance.id));
  return { accountId, assistantId, account: account!, privacySettings, voiceSettings };
}

type Seed = Awaited<ReturnType<typeof seed>>;

type Call = {
  seed: Seed;
  sessionId: string;
  runtime: VoiceRuntimeSession;
  channel: MockControlChannel;
  provider: MockRealtimeVoiceProvider;
};

/** A live call as the mint builds it: admitted, provider session, sideband, row, registered. */
async function liveCall(
  opts: {
    seed?: Seed;
    source?: "widget" | "playground";
    record?: boolean;
    provider?: MockRealtimeVoiceProvider;
    visitorId?: string;
  } = {},
): Promise<Call> {
  const s = opts.seed ?? (await seed());
  const source = opts.source ?? "widget";
  const visitorId = opts.visitorId ?? "visitor01";
  const sessionId = createId();
  const persistence = resolveEffectiveVoicePersistence(s.privacySettings, s.voiceSettings);
  const admitted = await admitVoiceSession({
    sessionId,
    assistantId: s.assistantId,
    account: s.account,
    source,
    visitorId,
    ephemeral: persistence.ephemeral,
    providerId: "gpt-live",
    model: "gpt-live-1",
    voiceId: "marin",
  });
  if (!admitted.ok) throw new Error(admitted.reason);
  const provider = opts.provider ?? new MockRealtimeVoiceProvider();
  const created = await provider.createWebRtcSession({
    sdpOffer: "v=0\r\n",
    sessionConfig: { model: "gpt-live-1", voice: "marin", delegationMode: "client" } as Parameters<
      typeof provider.createWebRtcSession
    >[0]["sessionConfig"],
  });
  const startedAt = new Date(Date.now() - 60_000);
  await markVoiceProviderCreated({ sessionId, providerSessionId: created.providerSessionId, startedAt });
  const channel = (await provider.attachControlChannel(created.providerSessionId)) as MockControlChannel;
  const conversationId = persistence.ephemeral
    ? null
    : await createVoiceConversation({ assistantId: s.assistantId, visitorId, source });
  const runtime = fakeVoiceRuntime({
    sessionId,
    providerSessionId: created.providerSessionId,
    assistantId: s.assistantId,
    source,
    visitorId,
    ephemeral: persistence.ephemeral,
    persistence,
    conversationId,
    channel,
    provider,
    providerId: "gpt-live",
    status: "connecting",
    startedAt,
    metering: createVoiceMeter(admitted.admission),
    recordingConsentAt: opts.record ? new Date() : null,
    recordingRetentionDays: "off",
    endReason: null,
  });
  runtime.assistant!.hostingAccount = s.account;
  superviseSideband(runtime, channel);
  if (persistence.ephemeral) await insertOperationalVoiceSessionRow(runtime);
  else await insertDurableVoiceSessionRow(runtime);
  if (opts.record) expect(await startVoiceRecording(runtime)).toBe(true);
  registerVoiceRuntime(runtime);
  return { seed: s, sessionId, runtime, channel, provider };
}

/** Visitor speech (media evidence) + provider usage; with audio frames for the recorder. */
async function talk(call: Call, usageSeconds: number, audio = false) {
  if (audio) {
    for (let i = 0; i < 3; i += 1) {
      call.channel.simulateInputAudio(tone(440, 100));
      await sleep(100);
    }
    call.channel.simulateOutputAudio(tone(660, 300), 350);
  }
  call.channel.simulateInputTranscript(SECRET_PHRASE);
  call.channel.simulateOutputTranscript(`Noted: ${SECRET_PHRASE}`);
  call.channel.setUsageSeconds(usageSeconds);
  await sleep(20);
}

async function row(sessionId: string) {
  const [found] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, sessionId));
  return found!;
}

async function ledger(sessionId: string) {
  return db.select().from(usageEvents).where(eq(usageEvents.requestId, sessionId));
}

async function balance(s: Seed) {
  const [found] = await db.select().from(usagePeriodBalances).where(eq(usagePeriodBalances.accountId, s.accountId));
  return found!;
}

async function beat(sessionId: string, visitorId: string | null) {
  delete (globalThis as Record<string, unknown>).__chatai_voice_last_heartbeat__;
  const token = createVoiceControlToken({ sessionId, visitorId })!;
  const response = await heartbeatPOST(
    new Request(`http://localhost:3000/api/v1/voice/sessions/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  return (await response.json()) as { state: string; endReason?: string };
}

function expectCleanReport(report: VoiceDrainReport, expected: Partial<VoiceDrainReport>) {
  expect(report).toMatchObject({ timedOut: 0, recordingsPending: 0, ...expected });
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
  state.env.VOICE_RECORDING_SPOOL_DIR = mkdtempSync(path.join(tmpdir(), "chatai-shutdown-spool-"));
}, 60_000);

afterAll(async () => {
  setObjectStorageForTests(undefined);
  setRecordingUploadDelaysForTests(null);
  await close();
});

beforeEach(async () => {
  setVoiceMeterAutoTickForTests(false);
  resetVoiceShutdownForTests();
  clearVoiceRuntimeForTests();
  clearEndedVoiceSessionsForTests();
  setObjectStorageForTests(createMemoryObjectStorage());
  setRecordingUploadDelaysForTests([0, 0, 0]);
  // A deliberately stuck finalization would hold every later drain to its deadline.
  pendingRecordingFinalizations().clear();
  // Mock provider session ids repeat per provider instance: park earlier open rows.
  await db.update(voiceSessions).set({ meteringStatus: "not_billable" }).where(eq(voiceSessions.meteringStatus, "open"));
});

afterEach(() => {
  setVoiceMeterAutoTickForTests(true);
  resetVoiceShutdownForTests();
});

describe("graceful Voice drain", () => {
  it("zero live sessions: marks draining and completes at once", async () => {
    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });
    expectCleanReport(report, { live: 0, closedFinal: 0, estimated: 0, recordingsFinalized: 0 });
    expect(report.durationMs).toBeLessThan(200);
    expect(isVoiceDraining()).toBe(true);
  });

  it("one live call: provider hangup → provider-final → one settlement, reservation released, complete recording", async () => {
    const call = await liveCall({
      seed: await seed({ voice: { enabled: true, saveTranscripts: true, saveAudioRecordings: true } }),
      record: true,
    });
    await talk(call, 30, true);

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

    expectCleanReport(report, { live: 1, closedFinal: 1, estimated: 0, recordingsFinalized: 1 });
    expect(call.provider.hangups).toEqual([call.runtime.providerSessionId]);
    expect(getVoiceRuntime(call.sessionId)).toBeUndefined();
    expect(await row(call.sessionId)).toMatchObject({
      status: "ended",
      errorCode: "shutdown",
      meteringStatus: "settled",
      usageMeasurement: "provider_final",
      voiceSeconds: 30,
    });
    expect(await ledger(call.sessionId)).toHaveLength(1);
    expect(await balance(call.seed)).toMatchObject({ voiceSecondsConsumed: 30, voiceSecondsReserved: 0 });

    const [recording] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.sessionId, call.sessionId));
    expect(recording).toMatchObject({ status: "ready", partial: false, timelineVersion: 2 });
    expect(recording!.durationMs).toBeGreaterThan(0);
    await expect(stat(recordingSpoolPath(recording!.id))).rejects.toThrow();

    // Owners see the administrative reason; widget visitors the neutral one.
    const ended = getEndedVoiceSession(call.sessionId)!;
    expect(ended.result.endReason).toBe("shutdown");
    expect(publicEndResult(ended.result, "widget").endReason).toBe("disconnected");
  });

  it("multiple simultaneous calls: every runtime closed, each settled exactly once", async () => {
    const calls = await Promise.all([liveCall(), liveCall({ source: "playground" }), liveCall({ visitorId: "visitor02" })]);
    await Promise.all(calls.map((call, i) => talk(call, 10 + i)));

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

    expectCleanReport(report, { live: 3, closedFinal: 3, estimated: 0 });
    expect(listVoiceRuntimes()).toHaveLength(0);
    for (const [i, call] of calls.entries()) {
      expect(call.provider.hangups).toEqual([call.runtime.providerSessionId]);
      expect(await row(call.sessionId)).toMatchObject({ usageMeasurement: "provider_final", voiceSeconds: 10 + i });
      expect(await ledger(call.sessionId)).toHaveLength(1);
      expect((await balance(call.seed)).voiceSecondsReserved).toBe(0);
    }
  });

  it("sideband down at drain: re-attaches first, then hangs up and still gets provider-final", async () => {
    const provider = new MockRealtimeVoiceProvider({ reattach: "refuse" });
    const call = await liveCall({ provider });
    await talk(call, 20);
    call.channel.simulateSidebandDrop();
    await sleep(10);
    expect(call.channel.isConnected()).toBe(false);
    provider.hooks.reattach = "ok";

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

    expectCleanReport(report, { closedFinal: 1 });
    expect(provider.hangups).toEqual([call.runtime.providerSessionId]);
    expect(await row(call.sessionId)).toMatchObject({ usageMeasurement: "provider_final", voiceSeconds: 20 });
    expect(await ledger(call.sessionId)).toHaveLength(1);
  });

  it("hangup fails: the sideband close fallback still yields provider-final", async () => {
    const call = await liveCall({ provider: new MockRealtimeVoiceProvider({ failHangup: true }) });
    await talk(call, 25);
    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });
    expectCleanReport(report, { closedFinal: 1 });
    expect(await row(call.sessionId)).toMatchObject({ usageMeasurement: "provider_final", voiceSeconds: 25 });
    expect(await ledger(call.sessionId)).toHaveLength(1);
  });

  it("hangup fails and no sideband: checkpoint (lower-bound) settlement, exactly once", async () => {
    const provider = new MockRealtimeVoiceProvider({ failHangup: true, reattach: "refuse" });
    const call = await liveCall({ provider });
    await talk(call, 18);
    call.channel.simulateSidebandDrop();

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

    expectCleanReport(report, { closedFinal: 0, estimated: 1 });
    expect(await row(call.sessionId)).toMatchObject({
      meteringStatus: "estimated",
      usageMeasurement: "provider_checkpoint",
      errorCode: "shutdown",
    });
    expect((await row(call.sessionId)).voiceSeconds).toBeGreaterThanOrEqual(18);
    expect(await ledger(call.sessionId)).toHaveLength(1);
    expect((await balance(call.seed)).voiceSecondsReserved).toBe(0);
  });

  it("session.closed never arrives: the drain stays within its bound and settles from the checkpoint", async () => {
    const call = await liveCall({ provider: new MockRealtimeVoiceProvider({ withholdClosedEvent: true }) });
    await talk(call, 12);

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 1_200 });

    expectCleanReport(report, { closedFinal: 0, estimated: 1 });
    // The 5 s closed-wait was cut to the provider share of the 1.2 s grace.
    expect(report.durationMs).toBeLessThan(1_200);
    expect(call.provider.hangups).toEqual([call.runtime.providerSessionId]);
    expect(await row(call.sessionId)).toMatchObject({ usageMeasurement: "provider_checkpoint", voiceSeconds: 12 });
    expect(await ledger(call.sessionId)).toHaveLength(1);
  });

  it("settlement fails (database error): reported as deferred, row left open for recovery, never double-settled", async () => {
    const call = await liveCall();
    await talk(call, 9);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    state.db = new Proxy(db, {
      get: (target, key, receiver) =>
        key === "transaction"
          ? () => Promise.reject(new Error("connection terminated"))
          : Reflect.get(target, key, receiver),
    });
    try {
      const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });
      expect(report).toMatchObject({ live: 1, closedFinal: 0, estimated: 0, settlementDeferred: 1, timedOut: 0 });
      expect(warn.mock.calls.some((c) => c[0] === "[voice] shutdown.drain")).toBe(true);
    } finally {
      state.db = db;
      error.mockRestore();
      warn.mockRestore();
    }
    expect(call.provider.hangups).toEqual([call.runtime.providerSessionId]);
    expect((await row(call.sessionId)).meteringStatus).toBe("open");
    expect(await ledger(call.sessionId)).toHaveLength(0);
  });

  it("recording finalization past the grace: exits on time, never marked complete, spool kept for crash recovery", async () => {
    const storage = createMemoryObjectStorage();
    const blocked = { ...storage, putFile: () => new Promise<never>(() => undefined) };
    setObjectStorageForTests(blocked);
    const call = await liveCall({
      seed: await seed({ voice: { enabled: true, saveTranscripts: true, saveAudioRecordings: true } }),
      record: true,
    });
    await talk(call, 15, true);

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 1_500 });

    expect(report).toMatchObject({ closedFinal: 1, timedOut: 0, recordingsFinalized: 0, recordingsPending: 1 });
    expect(report.durationMs).toBeLessThan(2_000);
    // Usage is settled even though the recording is not.
    expect(await ledger(call.sessionId)).toHaveLength(1);
    const [recording] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.sessionId, call.sessionId));
    expect(recording).toMatchObject({ status: "pending", partial: false });
    await expect(stat(recordingSpoolPath(recording!.id))).resolves.toBeTruthy();

    // After the restart: the crash sweep publishes what the spool holds, as partial.
    activeRecordingIds().clear();
    setObjectStorageForTests(storage);
    await runRecordingMaintenance(new Date(Date.now() + 10 * 60_000));
    const [recovered] = await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recording!.id));
    expect(recovered).toMatchObject({ status: "ready", partial: true });
  });

  it("no-store call stays no-store through the drain: settled, but no content, events or recording", async () => {
    const messagesBefore = (await db.select({ id: messages.id }).from(messages)).length;
    const call = await liveCall({
      seed: await seed({
        privacy: { storeConversations: false },
        voice: { enabled: true, saveTranscripts: true, saveAudioRecordings: true },
      }),
    });
    await talk(call, 9);

    const report = await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

    expectCleanReport(report, { closedFinal: 1 });
    expect(await row(call.sessionId)).toMatchObject({
      ephemeral: true,
      conversationId: null,
      meteringStatus: "settled",
      usageMeasurement: "provider_final",
    });
    expect(await db.select().from(voiceEvents).where(eq(voiceEvents.sessionId, call.sessionId))).toHaveLength(0);
    expect(await db.select().from(voiceRecordings).where(eq(voiceRecordings.sessionId, call.sessionId))).toHaveLength(0);
    expect(await db.select({ id: messages.id }).from(messages)).toHaveLength(messagesBefore);
    expect(call.runtime.inputTranscript).toBe("");
  });

  it("heartbeat during the drain answers ended with a public-safe reason, before and after the close", async () => {
    const widget = await liveCall();
    const owner = await liveCall({ source: "playground", visitorId: "owner" });
    await Promise.all([talk(widget, 5), talk(owner, 5)]);
    expect((await beat(widget.sessionId, "visitor01")).state).toBe("healthy");

    const drain = drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });
    const during = [await beat(widget.sessionId, "visitor01"), await beat(owner.sessionId, "owner")];
    await drain;
    const after = [await beat(widget.sessionId, "visitor01"), await beat(owner.sessionId, "owner")];

    expect(during).toEqual([
      expect.objectContaining({ state: "ended", endReason: "disconnected" }),
      expect.objectContaining({ state: "ended", endReason: "shutdown" }),
    ]);
    expect(after).toEqual([
      expect.objectContaining({ state: "ended", endReason: "disconnected" }),
      expect.objectContaining({ state: "ended", endReason: "shutdown" }),
    ]);
    // Visitors never learn about deployments, signals or infrastructure.
    expect(JSON.stringify([during[0], after[0]])).not.toMatch(/shutdown|sigterm|deploy|maintenance|restart/i);
  });

  it("drain logs are sanitized: counts only, no transcript, token or secret", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => void lines.push(JSON.stringify(args));
    const spies = [
      vi.spyOn(console, "info").mockImplementation(capture),
      vi.spyOn(console, "warn").mockImplementation(capture),
      vi.spyOn(console, "error").mockImplementation(capture),
    ];
    try {
      const call = await liveCall();
      await talk(call, 7);
      const token = createVoiceControlToken({ sessionId: call.sessionId, visitorId: "visitor01" })!;
      await drainVoiceRuntime({ trigger: "SIGTERM", graceMs: 8_000 });

      const all = lines.join("\n");
      expect(all).toContain("shutdown.begin");
      expect(all).toContain("shutdown.drain");
      expect(all).not.toContain(SECRET_PHRASE);
      expect(all).not.toContain("4417-9921");
      expect(all).not.toContain(token);
      expect(all).not.toContain(state.env.BETTER_AUTH_SECRET);
      expect(all).not.toMatch(/sk-[A-Za-z0-9]/);
      const drainLine = lines.find((line) => line.includes("shutdown.drain"))!;
      expect(JSON.parse(drainLine)[1]).toMatchObject({
        trigger: "SIGTERM",
        live: 1,
        closedFinal: 1,
        estimated: 0,
        timedOut: 0,
        recordingsFinalized: 0,
        recordingsPending: 0,
        durationMs: expect.any(Number),
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("signal handling", () => {
  it("registers once; SIGTERM/SIGINT repeated → one drain, one hangup, one ledger row, one exit", async () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    expect(installVoiceShutdownHandlers({ target, exit, graceMs: 8_000 })).toBe(true);
    expect(installVoiceShutdownHandlers({ target, exit, graceMs: 8_000 })).toBe(false);
    expect(target.listenerCount("SIGTERM")).toBe(1);
    expect(target.listenerCount("SIGINT")).toBe(1);

    const call = await liveCall({ source: "playground", visitorId: "owner" });
    await talk(call, 14);

    target.emit("SIGTERM");
    target.emit("SIGINT");
    target.emit("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    target.emit("SIGINT");
    await sleep(50);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(call.provider.hangups).toEqual([call.runtime.providerSessionId]);
    expect(await ledger(call.sessionId)).toHaveLength(1);
    expect(await row(call.sessionId)).toMatchObject({ usageMeasurement: "provider_final", voiceSeconds: 14 });
  });

  it("with nothing live, the first signal exits promptly", async () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    installVoiceShutdownHandlers({ target, exit, graceMs: 8_000 });
    const startedAt = Date.now();
    target.emit("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
