import type { VoiceMeteringMode } from "@chatai/database";

import {
  CHECKPOINT_MAX_INTERVAL_MS,
  CHECKPOINT_MIN_ADVANCE_SECONDS,
  checkpointVoiceUsage,
  markVoiceConnected,
} from "./metering";
import type { VoiceAdmission } from "./quota";
import { extendVoiceGrant } from "./quota";
import type { VoiceRuntimeSession } from "./session-runtime";

/** Request the next block when the enforcement clock is this close to the grant. */
export const VOICE_EXTEND_LEAD_SECONDS = 60;
/** Best-effort spoken warning this long before the final grant runs out. */
export const VOICE_WARNING_LEAD_SECONDS = 30;
const EXTEND_RETRY_MS = 5_000;
const METER_TICK_MS = 1_000;

export const VOICE_LIMIT_WARNING_INSTRUCTIONS =
  "At the next natural pause, without interrupting yourself, briefly tell the user that this voice call will end in a few moments and that they can continue by typing in the chat. Do not mention plans, minutes or limits.";

/**
 * In-memory meter for a live session. The durable row is the source of truth for
 * settlement; this only drives checkpoints and quota enforcement.
 */
export type VoiceMeterState = {
  mode: VoiceMeteringMode;
  quotaExempt: boolean;
  enforced: boolean;
  granted: number;
  /** Latest provider cumulative snapshot and when it arrived (enforcement clock base). */
  snapshotSeconds: number;
  snapshotAtMs: number;
  lastCheckpointSeconds: number;
  lastCheckpointAtMs: number;
  connectedAt: Date | null;
  exhausted: boolean;
  lastExtendAttemptMs: number;
  warningSent: boolean;
  limitClosing: boolean;
  ticking: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

let clock: () => number = () => Date.now();
let autoTick = true;

/** Test hooks: deterministic meter time and manual ticks. */
export function setVoiceMeterClockForTests(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}

export function setVoiceMeterAutoTickForTests(enabled: boolean): void {
  autoTick = enabled;
}

export function voiceMeterNow(): number {
  return clock();
}

export function createVoiceMeter(admission: VoiceAdmission): VoiceMeterState {
  const now = clock();
  return {
    mode: admission.mode,
    quotaExempt: admission.quotaExempt,
    enforced: admission.enforced,
    granted: admission.granted,
    snapshotSeconds: 0,
    snapshotAtMs: now,
    lastCheckpointSeconds: 0,
    lastCheckpointAtMs: now,
    connectedAt: null,
    exhausted: false,
    lastExtendAttemptMs: 0,
    warningSent: false,
    limitClosing: false,
    ticking: false,
    timer: null,
  };
}

/**
 * Seconds used for extend/close decisions only (never billed):
 * max(snapshot, snapshot + wall clock since it), robust to sparse usage events.
 */
export function enforcementClockSeconds(meter: VoiceMeterState, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - meter.snapshotAtMs) / 1000;
  return meter.snapshotSeconds + elapsed;
}

export function startVoiceMeter(session: VoiceRuntimeSession): void {
  const meter = session.metering;
  if (!meter || meter.timer || !autoTick) return;
  const timer = setInterval(() => void tickVoiceMeter(session), METER_TICK_MS);
  timer.unref?.();
  meter.timer = timer;
}

export function stopVoiceMeter(session: VoiceRuntimeSession): void {
  const meter = session.metering;
  if (!meter?.timer) return;
  clearInterval(meter.timer);
  meter.timer = null;
}

/** Cumulative provider snapshot: replaces (never sums); older values are ignored. */
export function recordVoiceUsageSnapshot(session: VoiceRuntimeSession, seconds: number): void {
  const meter = session.metering;
  if (!meter) return;
  const now = clock();
  if (seconds >= meter.snapshotSeconds) {
    meter.snapshotSeconds = seconds;
    meter.snapshotAtMs = now;
  }
  if (
    seconds - meter.lastCheckpointSeconds >= CHECKPOINT_MIN_ADVANCE_SECONDS ||
    now - meter.lastCheckpointAtMs >= CHECKPOINT_MAX_INTERVAL_MS
  ) {
    void writeCheckpoint(session, now);
  }
}

export function recordVoiceMediaEvidence(session: VoiceRuntimeSession): void {
  const meter = session.metering;
  if (!meter || meter.connectedAt) return;
  meter.connectedAt = new Date(clock());
  void markVoiceConnected(session.sessionId, meter.connectedAt).catch(() => undefined);
}

async function writeCheckpoint(session: VoiceRuntimeSession, now: number): Promise<void> {
  const meter = session.metering;
  if (!meter) return;
  const seconds = Math.max(meter.snapshotSeconds, session.usageSeconds);
  meter.lastCheckpointSeconds = seconds;
  meter.lastCheckpointAtMs = now;
  await checkpointVoiceUsage(session.sessionId, seconds, new Date(now)).catch(() => undefined);
}

function sendLimitWarning(session: VoiceRuntimeSession): void {
  // Instructions only: never a delegation, never RAG, never awaited.
  void session.channel
    ?.appendInstructions(VOICE_LIMIT_WARNING_INSTRUCTIONS, null)
    .catch(() => undefined);
}

/**
 * One enforcement step: heartbeat checkpoint, extend near the grant, warn once, and
 * close at the granted seconds when nothing more can be granted.
 */
export async function tickVoiceMeter(
  session: VoiceRuntimeSession,
  nowMs: number = clock(),
): Promise<void> {
  const meter = session.metering;
  if (!meter || meter.ticking || meter.limitClosing || session.terminating) return;
  meter.ticking = true;
  try {
    if (nowMs - meter.lastCheckpointAtMs >= CHECKPOINT_MAX_INTERVAL_MS) {
      await writeCheckpoint(session, nowMs);
    }
    if (!meter.enforced) return;

    const usedSeconds = enforcementClockSeconds(meter, nowMs);
    if (
      usedSeconds >= meter.granted - VOICE_EXTEND_LEAD_SECONDS &&
      nowMs - meter.lastExtendAttemptMs >= EXTEND_RETRY_MS
    ) {
      meter.lastExtendAttemptMs = nowMs;
      const added = await extendVoiceGrant(session.sessionId, new Date(nowMs)).catch(() => 0);
      if (added > 0) {
        meter.granted += added;
        meter.exhausted = false;
      } else {
        meter.exhausted = true;
      }
    }
    if (session.terminating) return;

    if (meter.exhausted && !meter.warningSent && usedSeconds >= meter.granted - VOICE_WARNING_LEAD_SECONDS) {
      meter.warningSent = true;
      sendLimitWarning(session);
    }
    if (meter.exhausted && usedSeconds >= meter.granted) {
      meter.limitClosing = true;
      session.endReason = "usage_limit";
      const { terminateVoiceSession } = await import("./lifecycle");
      void terminateVoiceSession(session, {
        reason: "close_requested",
        requestProviderClose: true,
        errorCode: "usage_limit",
      });
    }
  } finally {
    meter.ticking = false;
  }
}
