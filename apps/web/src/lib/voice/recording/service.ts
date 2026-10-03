import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  and,
  eq,
  voiceRecordings,
  type EffectiveVoicePersistence,
  type ResolvedVoiceSettings,
} from "@chatai/database";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { getObjectStorage, isObjectStorageAvailable } from "@/lib/storage/object-storage";

import { writeLifecycleVoiceEvent } from "../persist";
import type { VoiceRuntimeSession } from "../session-runtime";
import { AlignmentDiagnostics } from "./alignment-diagnostics";
import { muxOpusPacketsToWebm, readPacketSpool, RECORDING_CONTENT_TYPE, StereoOpusEncoder } from "./codec";
import { VoiceTurnOffsets } from "../turn-offsets";
import { VoiceSessionRecorder, type RecordingTimelineVersion } from "./recorder";

/** Timeline version stamped on new recordings; existing rows keep theirs (V1). */
export const RECORDING_TIMELINE_VERSION: RecordingTimelineVersion = 2;

export type RecordingRetentionDays = ResolvedVoiceSettings["recordingRetentionDays"];

/** Live recorder state on a runtime session (never serialized, never sent to clients). */
export type ActiveVoiceRecording = {
  recordingId: string;
  storageKey: string;
  spoolPath: string;
  recorder: VoiceSessionRecorder;
  retentionDays: RecordingRetentionDays;
  unsubscribe: () => void;
};

/**
 * Whether a session with this persistence would be recorded. Precedence:
 * global no-store > assistant "Record Voice audio" > instance object storage.
 * Consent is checked separately at mint.
 */
export function recordingApplies(persistence: EffectiveVoicePersistence): boolean {
  return (
    !persistence.ephemeral &&
    persistence.storeConversations &&
    persistence.saveAudioRecordings &&
    isObjectStorageAvailable()
  );
}

/** Visitors on public surfaces (widget, owner playground) always see the disclosure. */
export function recordingConsentRequired(
  source: VoiceRuntimeSession["source"],
  voice: Pick<ResolvedVoiceSettings, "requireRecordingConsent">,
): boolean {
  return source !== "api" || voice.requireRecordingConsent;
}

export function recordingStorageKey(assistantId: string, recordingId: string): string {
  return `voice/${assistantId}/${recordingId}.webm`;
}

export function recordingSpoolDir(): string {
  return path.resolve(env.VOICE_RECORDING_SPOOL_DIR);
}

export function recordingSpoolPath(recordingId: string): string {
  return path.join(recordingSpoolDir(), `${recordingId}.opus-spool`);
}

export function recordingExpiresAt(retentionDays: RecordingRetentionDays, from: Date): Date | null {
  return retentionDays === "off" ? null : new Date(from.getTime() + retentionDays * 86_400_000);
}

type RecordingRegistry = Set<string>;
const registryKey = "__chatai_voice_recording_registry__";

/** Recordings owned by this process (recording or finalizing); the crash sweep skips them. */
export function activeRecordingIds(): RecordingRegistry {
  const g = globalThis as typeof globalThis & { [registryKey]?: RecordingRegistry };
  return (g[registryKey] ??= new Set());
}

export type UploadRetryOptions = { delaysMs?: number[] };
/** 3 retries with exponential backoff (~2 minutes in total). */
const DEFAULT_UPLOAD_DELAYS_MS = [10_000, 30_000, 80_000];

let uploadDelaysOverride: number[] | null = null;
/** Tests only. */
export function setRecordingUploadDelaysForTests(delays: number[] | null): void {
  uploadDelaysOverride = delays;
}

async function logRecordingError(session: VoiceRuntimeSession | null, code: string): Promise<void> {
  if (!session) return;
  await writeLifecycleVoiceEvent(session, "error", { scope: "recording", code }).catch(() => undefined);
}

async function markRecordingFailed(recordingId: string, errorCode: string): Promise<void> {
  await db()
    .update(voiceRecordings)
    // storageKey is kept so deletion still removes any object a partial upload left behind.
    .set({ status: "failed", errorCode, updatedAt: new Date() })
    .where(and(eq(voiceRecordings.id, recordingId), eq(voiceRecordings.status, "pending")));
}

/**
 * Start recording a Voice session. Best-effort: returns false (and leaves the
 * session untouched) if anything fails. Requires the durable session row.
 */
export async function startVoiceRecording(session: VoiceRuntimeSession): Promise<boolean> {
  const channel = session.channel;
  if (
    !recordingApplies(session.persistence) ||
    !session.conversationId ||
    !session.durableRowInserted ||
    !channel?.subscribeAudio
  ) {
    return false;
  }

  const recordingId = createId();
  const storageKey = recordingStorageKey(session.assistantId, recordingId);
  const spoolPath = recordingSpoolPath(recordingId);
  const registry = activeRecordingIds();
  registry.add(recordingId);

  let recorder: VoiceSessionRecorder | null = null;
  try {
    await mkdir(recordingSpoolDir(), { recursive: true });
    recorder = await VoiceSessionRecorder.start(spoolPath, { timelineVersion: RECORDING_TIMELINE_VERSION });
    await db().insert(voiceRecordings).values({
      id: recordingId,
      sessionId: session.sessionId,
      conversationId: session.conversationId,
      kind: "mix",
      status: "pending",
      storageKey,
      contentType: RECORDING_CONTENT_TYPE,
      startMs: 0,
      timelineVersion: RECORDING_TIMELINE_VERSION,
    });
  } catch {
    registry.delete(recordingId);
    await recorder?.stop().catch(() => undefined);
    await rm(spoolPath, { force: true }).catch(() => undefined);
    await logRecordingError(session, "recording_start_failed");
    return false;
  }

  const active = recorder;
  const unsubscribeAudio = channel.subscribeAudio((frame) => active.onAudio(frame));
  const unsubscribeTiming = channel.subscribe((event) => {
    if (event.type === "control.disconnected") {
      active.onControl("disconnected");
      // A re-attach that completed inside this dispatch reached us before the drop did.
      if (channel.isConnected?.() === true) active.onControl("reattached");
    } else if (event.type === "control.reattached") active.onControl("reattached");
    else if (event.type === "transcript.input.delta") active.noteProviderTime(event.endMs);
  });
  session.turnOffsets = new VoiceTurnOffsets(() => active.onsets && {
    input: active.onsets.input.runs,
    output: active.onsets.output.runs,
  });
  const stopDiagnostics = env.VOICE_ALIGNMENT_DIAGNOSTICS
    ? attachAlignmentDiagnostics(session, recordingId, active)
    : null;
  session.recording = {
    recordingId,
    storageKey,
    spoolPath,
    recorder: active,
    retentionDays: session.recordingRetentionDays,
    unsubscribe: () => {
      unsubscribeAudio();
      unsubscribeTiming();
      stopDiagnostics?.();
    },
  };
  return true;
}

function attachAlignmentDiagnostics(
  session: VoiceRuntimeSession,
  recordingId: string,
  recorder: VoiceSessionRecorder,
): () => void {
  const channel = session.channel!;
  const diagnostics = new AlignmentDiagnostics(session.startedAt.getTime());
  const offAudio = channel.subscribeAudio!((frame) => diagnostics.onAudio(frame));
  const offEvents = channel.subscribe((event) => {
    if (event.type === "transcript.input.delta" || event.type === "transcript.output.delta") {
      diagnostics.onTranscript(
        event.type === "transcript.input.delta" ? "input" : "output",
        event.startMs,
        event.endMs,
      );
    } else if (event.type === "control.disconnected") {
      diagnostics.onDisconnected();
      if (channel.isConnected?.() === true) diagnostics.onReattached(0);
    } else if (event.type === "control.reattached") {
      diagnostics.onReattached(event.gapMs);
    }
  });
  return () => {
    offAudio();
    offEvents();
    console.info(
      "[voice.alignment]",
      JSON.stringify({
        sessionId: session.sessionId,
        recordingId,
        timelineVersion: recorder.timelineVersion,
        ...diagnostics.summary(),
        timeline: recorder.timelineStats,
        turnOffsets: session.turnOffsets?.stats ?? null,
      }),
    );
  };
}

export type RecordingFinishOutcome = PublishResult;

const finalizingKey = "__chatai_voice_recording_finalizations__";
type FinalizationListener = (work: Promise<RecordingFinishOutcome>) => void;
type FinalizationRegistry = { pending: Set<Promise<RecordingFinishOutcome>>; listeners: Set<FinalizationListener> };

function finalizations(): FinalizationRegistry {
  const g = globalThis as typeof globalThis & { [finalizingKey]?: FinalizationRegistry };
  return (g[finalizingKey] ??= { pending: new Set(), listeners: new Set() });
}

/** Recording finalizations still running in this process (graceful shutdown awaits them). */
export function pendingRecordingFinalizations(): Set<Promise<RecordingFinishOutcome>> {
  return finalizations().pending;
}

/** Be told about every finalization that starts from now on (graceful shutdown). */
export function observeRecordingFinalizations(listener: FinalizationListener): () => void {
  const { listeners } = finalizations();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Detach and finalize in the background. Never awaited by `/end`; the returned
 * promise exists for tests and shutdown, and never rejects.
 */
export function finishVoiceRecording(session: VoiceRuntimeSession): Promise<RecordingFinishOutcome> | null {
  const rec = session.recording;
  if (!rec) return null;
  session.recording = null;
  rec.unsubscribe();
  const work = (async (): Promise<RecordingFinishOutcome> => {
    try {
      const stopped = await rec.recorder.stop();
      if (!stopped.ok) {
        await markRecordingFailed(rec.recordingId, stopped.errorCode);
        await logRecordingError(session, stopped.errorCode);
        await rm(rec.spoolPath, { force: true });
        return "failed";
      }
      const result = await publishSpooledRecording({
        recordingId: rec.recordingId,
        storageKey: rec.storageKey,
        spoolPath: rec.spoolPath,
        preSkip: rec.recorder.preSkip,
        partial: false,
        retentionDays: rec.retentionDays,
      });
      if (result === "failed") await logRecordingError(session, "recording_upload_failed");
      return result;
    } catch {
      await markRecordingFailed(rec.recordingId, "recording_finalize_failed").catch(() => undefined);
      await rm(rec.spoolPath, { force: true }).catch(() => undefined);
      return "failed";
    } finally {
      activeRecordingIds().delete(rec.recordingId);
    }
  })();
  const { pending, listeners } = finalizations();
  pending.add(work);
  void work.finally(() => pending.delete(work));
  for (const listener of listeners) listener(work);
  return work;
}

export type PublishResult = "ready" | "empty" | "discarded" | "failed";

/**
 * Mux a packet spool to WebM, upload it, and mark the row ready. Shared by
 * normal finalize and the crash sweep (`partial`). Always removes local files.
 */
export async function publishSpooledRecording(input: {
  recordingId: string;
  storageKey: string;
  spoolPath: string;
  preSkip: number;
  partial: boolean;
  retentionDays: RecordingRetentionDays;
}): Promise<PublishResult> {
  const webmPath = `${input.spoolPath}.webm`;
  try {
    const [row] = await db()
      .select({ status: voiceRecordings.status })
      .from(voiceRecordings)
      .where(eq(voiceRecordings.id, input.recordingId))
      .limit(1);
    // Conversation/assistant deleted meanwhile: the recording must not outlive it.
    if (!row || row.status !== "pending") return "discarded";

    const packets = await readPacketSpool(input.spoolPath);
    if (packets.length === 0) {
      // No audio ever reached the recorder (e.g. media never connected).
      await db().delete(voiceRecordings).where(eq(voiceRecordings.id, input.recordingId));
      return "empty";
    }

    const storage = getObjectStorage();
    if (!storage) {
      await markRecordingFailed(input.recordingId, "recording_storage_unavailable");
      return "failed";
    }

    const { durationMs } = await muxOpusPacketsToWebm(packets, webmPath, input.preSkip);
    const delays = uploadDelaysOverride ?? DEFAULT_UPLOAD_DELAYS_MS;
    let byteSize: number | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        ({ byteSize } = await storage.putFile(input.storageKey, webmPath, {
          contentType: RECORDING_CONTENT_TYPE,
        }));
        break;
      } catch {
        if (attempt === delays.length) break;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
    if (byteSize === null) {
      await markRecordingFailed(input.recordingId, "recording_upload_failed");
      return "failed";
    }

    const now = new Date();
    const updated = await db()
      .update(voiceRecordings)
      .set({
        status: "ready",
        byteSize,
        durationMs,
        endMs: durationMs,
        partial: input.partial,
        expiresAt: recordingExpiresAt(input.retentionDays, now),
        updatedAt: now,
      })
      .where(and(eq(voiceRecordings.id, input.recordingId), eq(voiceRecordings.status, "pending")))
      .returning({ id: voiceRecordings.id });
    if (updated.length === 0) {
      // Row deleted while uploading: remove the object we just wrote.
      await storage.delete(input.storageKey).catch(() => undefined);
      return "discarded";
    }
    return "ready";
  } catch {
    await markRecordingFailed(input.recordingId, "recording_finalize_failed").catch(() => undefined);
    return "failed";
  } finally {
    await rm(input.spoolPath, { force: true }).catch(() => undefined);
    await rm(webmPath, { force: true }).catch(() => undefined);
  }
}

let cachedPreSkip: number | null = null;
/** Encoder pre-skip for spools recovered after a restart (same encoder configuration). */
export async function recordingPreSkip(): Promise<number> {
  if (cachedPreSkip !== null) return cachedPreSkip;
  const encoder = await StereoOpusEncoder.create();
  cachedPreSkip = encoder.preSkip;
  encoder.free();
  return cachedPreSkip;
}
