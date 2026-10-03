import { ControlAttachError, type ControlDisconnectCause, type VoiceControlChannel } from "@chatai/voice";

import { env } from "@/lib/env";

import { voiceNow } from "./clock";
import { logVoiceEvent, logVoiceWarning } from "./observability";
import { writeLifecycleVoiceEvent } from "./persist";
import { voiceControlOf, type VoiceRuntimeSession, type VoiceTurn } from "./session-runtime";

/**
 * Voice control plane: keeps a live call supervised by ChatAI.
 *
 * - Sideband loss → bounded re-attach (attempts at 0/1/2/4/8 s inside 15 s) →
 *   recovered, or lost (the call is ended with a provider hangup).
 * - Idle, heartbeat staleness and the runtime cap end calls server-side.
 * Logs carry ids and numbers only.
 */
export const VOICE_CONTROL_DEFAULTS = {
  /** Re-attach attempt offsets from the loss. */
  reattachOffsetsMs: [0, 1_000, 2_000, 4_000, 8_000],
  reattachWindowMs: 15_000,
  attachTimeoutMs: 5_000,
  /**
   * Gaps up to this are covered by the provider's replay backlog (~3 s observed,
   * not guaranteed); longer gaps may have lost turns or delegations.
   */
  replayTrustMs: 2_000,
  idleWarningMs: 180_000,
  idleGraceMs: 30_000,
  heartbeatIntervalMs: 5_000,
  heartbeatStaleMs: 45_000,
  maxDurationWarningLeadMs: 30_000,
  supervisionTickMs: 1_000,
};

export type VoiceControlSettings = typeof VOICE_CONTROL_DEFAULTS;

let overrides: Partial<VoiceControlSettings> | null = null;
let autoTick = true;

export function voiceControlSettings(): VoiceControlSettings {
  const idle = env.VOICE_IDLE_TIMEOUT_SECONDS;
  return {
    ...VOICE_CONTROL_DEFAULTS,
    ...(idle !== undefined ? { idleWarningMs: idle * 1000 } : {}),
    ...overrides,
  };
}

export function setVoiceControlSettingsForTests(next: Partial<VoiceControlSettings> | null): void {
  overrides = next;
}

export function setVoiceSupervisionAutoTickForTests(enabled: boolean): void {
  autoTick = enabled;
}

export const CONTROL_INTERRUPTED_COMMENTARY =
  "The lookup was interrupted. Apologize briefly and ask the user to repeat the question.";
export const CONTROL_GAP_INSTRUCTIONS =
  "If you are waiting for a result from the backend, it will not arrive. At a natural pause, apologize briefly and ask the user to repeat their last question.";
export const IDLE_CHECKIN_INSTRUCTIONS =
  "At a natural pause, briefly ask whether the user is still there and say the voice call will end soon if not.";
export const MAX_DURATION_WARNING_INSTRUCTIONS =
  "At the next natural pause, without interrupting yourself, briefly tell the user that this voice call will end in a few moments because it reached its maximum length, and that they can continue by typing in the chat.";

function isInFlight(turn: VoiceTurn): boolean {
  return turn.status === "collecting" || turn.status === "retrieving" || turn.status === "generating";
}

function isLive(session: VoiceRuntimeSession): boolean {
  return !session.terminating && session.status !== "ending" && session.status !== "ended" && session.status !== "failed";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("attach_timeout")), Math.max(0, ms));
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const reattachRuns = new WeakMap<VoiceRuntimeSession, Promise<void>>();

/** Resolves when an in-flight re-attach loop has finished (tests). */
export async function waitForVoiceControlIdle(session: VoiceRuntimeSession): Promise<void> {
  await reattachRuns.get(session);
}

/**
 * Sideband transport lost while the provider session may still be live. In-flight
 * lookups are aborted (their answers could arrive into a gap) and remembered for a
 * neutral fallback once control is back.
 */
export function handleControlDisconnected(
  session: VoiceRuntimeSession,
  event: { cause: ControlDisconnectCause; closeCode: number | null },
): void {
  if (!isLive(session)) return;
  const control = voiceControlOf(session);
  if (control.state !== "attached") return;

  control.state = "reattaching";
  control.lostAt = voiceNow();
  control.attempts = 0;
  session.counters.controlDisconnects += 1;

  for (const turn of session.turns) {
    if (!isInFlight(turn)) continue;
    turn.status = "superseded";
    turn.supersededBy = "control_lost";
    turn.abort.abort();
    session.counters.superseded += 1;
    control.interruptedDelegations.push(turn.delegationId);
  }

  logVoiceWarning("control.degraded", {
    sessionId: session.sessionId,
    cause: event.cause,
    closeCode: event.closeCode,
    interruptedDelegations: control.interruptedDelegations.length,
  });
  void writeLifecycleVoiceEvent(session, "session.reconnecting", {
    phase: "degraded",
    cause: event.cause,
  }).catch(() => undefined);

  const run = runReattachLoop(session).catch(() => undefined);
  reattachRuns.set(session, run);
}

async function reattachChannel(channel: VoiceControlChannel | null): Promise<void> {
  if (!channel?.reattach) throw new ControlAttachError("Control channel cannot re-attach.");
  await channel.reattach();
}

async function runReattachLoop(session: VoiceRuntimeSession): Promise<void> {
  const settings = voiceControlSettings();
  const control = voiceControlOf(session);
  const lostAt = control.lostAt ?? voiceNow();
  const deadline = lostAt + settings.reattachWindowMs;

  for (const offset of settings.reattachOffsetsMs) {
    const wait = lostAt + offset - voiceNow();
    if (wait > 0) await sleep(wait);
    if (!isLive(session) || control.state !== "reattaching") return;
    const remaining = deadline - voiceNow();
    if (remaining <= 0) break;

    control.attempts += 1;
    try {
      await withTimeout(reattachChannel(session.channel), Math.min(settings.attachTimeoutMs, remaining));
      handleControlReattached(session, voiceNow() - lostAt);
      return;
    } catch (error) {
      const gone = error instanceof ControlAttachError && error.sessionGone;
      logVoiceWarning("control.reattach_failed", {
        sessionId: session.sessionId,
        attempt: control.attempts,
        sessionGone: gone,
        status: error instanceof ControlAttachError ? error.status : null,
      });
      if (gone) break;
    }
  }

  if (!isLive(session) || control.state !== "reattaching") return;
  control.state = "lost";
  logVoiceWarning("control.lost", {
    sessionId: session.sessionId,
    attempts: control.attempts,
    elapsedMs: voiceNow() - lostAt,
  });
  void writeLifecycleVoiceEvent(session, "session.reconnecting", {
    phase: "lost",
    attempts: control.attempts,
  }).catch(() => undefined);
  session.endReason ??= "control_lost";
  const { terminateVoiceSession } = await import("./lifecycle");
  // No sideband to observe usage: hang up (hard stop) and settle from the checkpoint.
  await terminateVoiceSession(session, {
    reason: "connection_lost",
    requestProviderClose: true,
    reattach: false,
    errorCode: "sideband_lost",
  });
}

/**
 * Control is back (from the re-attach loop or the channel's `control.reattached`;
 * idempotent). Interrupted lookups get a neutral fallback; after a gap longer than
 * the replay backlog, delegations ChatAI never saw may be waiting forever, so the
 * live model is told to stop waiting.
 */
export function handleControlReattached(session: VoiceRuntimeSession, gapMs: number): void {
  const control = voiceControlOf(session);
  if (control.state !== "reattaching" || !isLive(session)) return;
  const settings = voiceControlSettings();

  control.state = "attached";
  control.lostAt = null;
  control.lastGapMs = gapMs;
  control.possibleLoss = gapMs > settings.replayTrustMs;
  session.counters.controlRecoveries += 1;
  const interrupted = control.interruptedDelegations.splice(0);
  if (session.supervision) session.supervision.idleSince = voiceNow();

  logVoiceEvent("control.recovered", {
    sessionId: session.sessionId,
    gapMs,
    attempts: control.attempts,
    replayTrusted: !control.possibleLoss,
    fallbacks: interrupted.length,
  });
  void writeLifecycleVoiceEvent(session, "session.reconnecting", {
    phase: "recovered",
    gapMs,
    attempts: control.attempts,
  }).catch(() => undefined);

  const channel = session.channel;
  if (!channel) return;
  for (const delegationId of interrupted) {
    void channel
      .appendCommentary(delegationId, CONTROL_INTERRUPTED_COMMENTARY)
      .then((result) => {
        if (result.ok) session.delegations.complete(delegationId);
      })
      .catch(() => undefined);
  }
  if (control.possibleLoss && interrupted.length === 0) {
    void channel.appendInstructions(CONTROL_GAP_INSTRUCTIONS, null).catch(() => undefined);
  }
}

/** Arm idle / heartbeat / max-duration supervision for a freshly minted runtime. */
export function startVoiceSupervision(
  session: VoiceRuntimeSession,
  options: { heartbeatCapable: boolean },
): void {
  const now = voiceNow();
  session.supervision = {
    idleSince: now,
    idleWarnedAt: null,
    maxDurationWarned: false,
    heartbeatCapable: options.heartbeatCapable,
    lastHeartbeatAt: now,
    timer: null,
  };
  if (!autoTick) return;
  const timer = setInterval(() => void tickVoiceSupervision(session), voiceControlSettings().supervisionTickMs);
  timer.unref?.();
  session.supervision.timer = timer;
}

export function recordVoiceHeartbeat(session: VoiceRuntimeSession): void {
  if (session.supervision) session.supervision.lastHeartbeatAt = voiceNow();
}

/**
 * One supervision step. Idle pauses while a lookup is in flight or control is
 * re-attaching (transcripts may be missing then); assistant speech never resets it.
 */
export async function tickVoiceSupervision(
  session: VoiceRuntimeSession,
  nowMs: number = voiceNow(),
): Promise<void> {
  const supervision = session.supervision;
  if (!supervision || !isLive(session)) return;
  const settings = voiceControlSettings();
  const { terminateVoiceSession, VOICE_RUNTIME_MAX_MS } = await import("./lifecycle");
  if (!isLive(session)) return;

  if (supervision.heartbeatCapable && nowMs - supervision.lastHeartbeatAt >= settings.heartbeatStaleMs) {
    logVoiceWarning("heartbeat.stale", {
      sessionId: session.sessionId,
      sinceMs: nowMs - supervision.lastHeartbeatAt,
    });
    session.endReason ??= "heartbeat_lost";
    void terminateVoiceSession(session, {
      reason: "close_requested",
      requestProviderClose: true,
      errorCode: "heartbeat_lost",
    });
    return;
  }

  const controlAttached = voiceControlOf(session).state === "attached";
  if (!supervision.maxDurationWarned && controlAttached) {
    const elapsed = nowMs - session.startedAt.getTime();
    if (elapsed >= VOICE_RUNTIME_MAX_MS - settings.maxDurationWarningLeadMs) {
      supervision.maxDurationWarned = true;
      logVoiceEvent("max_duration.warning", { sessionId: session.sessionId, elapsedMs: elapsed });
      void session.channel?.appendInstructions(MAX_DURATION_WARNING_INSTRUCTIONS, null).catch(() => undefined);
    }
  }

  if (settings.idleWarningMs <= 0) return;
  if (!controlAttached || session.turns.some(isInFlight)) {
    supervision.idleSince = nowMs;
    supervision.idleWarnedAt = null;
    return;
  }
  if (supervision.idleWarnedAt === null) {
    if (nowMs - supervision.idleSince >= settings.idleWarningMs) {
      supervision.idleWarnedAt = nowMs;
      logVoiceEvent("idle.warning", { sessionId: session.sessionId, idleMs: nowMs - supervision.idleSince });
      void session.channel?.appendInstructions(IDLE_CHECKIN_INSTRUCTIONS, null).catch(() => undefined);
    }
    return;
  }
  if (nowMs - supervision.idleWarnedAt >= settings.idleGraceMs) {
    logVoiceEvent("idle.timeout", { sessionId: session.sessionId, idleMs: nowMs - supervision.idleSince });
    session.endReason ??= "idle";
    void terminateVoiceSession(session, {
      reason: "close_requested",
      requestProviderClose: true,
      errorCode: "idle_timeout",
    });
  }
}

/** Heartbeat answer for a runtime owned by this process. */
export function voiceControlHealth(session: VoiceRuntimeSession): "healthy" | "degraded" | "ended" {
  if (!isLive(session)) return "ended";
  const state = voiceControlOf(session).state;
  return state === "attached" ? "healthy" : state === "reattaching" ? "degraded" : "ended";
}

/**
 * Wait (bounded) for the provider to confirm the browser command lock at
 * session.started. Anything but an explicit confirmation fails closed.
 */
export async function confirmBrowserCommandLock(
  session: VoiceRuntimeSession,
  channel: VoiceControlChannel,
  timeoutMs: number,
): Promise<boolean> {
  if (session.browserCommandsBlocked !== undefined) return session.browserCommandsBlocked;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    const unsubscribe = channel.subscribe((event) => {
      if (event.type === "session.started") finish(event.browserCommandsBlocked === true);
      if (event.type === "session.closed") finish(false);
    });
    const timer = setTimeout(() => finish(session.browserCommandsBlocked === true), timeoutMs);
    timer.unref?.();
  });
}
