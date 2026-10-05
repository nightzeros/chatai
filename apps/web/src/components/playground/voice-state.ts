export type VoiceConnection =
  | "idle"
  | "connecting"
  | "connected"
  /** Manual Reconnect after a media failure: a new session is being minted. */
  | "reconnecting"
  /** ChatAI control unreachable: mic and assistant muted until control returns or the grace ends. */
  | "degraded"
  | "failed"
  | "ended";

export type VoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "delegating"
  | "assistant_speaking"
  | "interrupted"
  | "reconnecting"
  | "control_lost"
  | "error"
  | "ended";

export type VoiceSignals = {
  connection: VoiceConnection;
  now: number;
  /** Last time mic energy or an input transcript delta was observed. */
  userVoiceAt: number | null;
  /** Last time remote audio energy or an output transcript delta was observed. */
  assistantVoiceAt: number | null;
  /** A delegation is in flight on the ChatAI side (collecting/retrieving/generating). */
  delegationActive: boolean;
  interruptedAt: number | null;
};

export const VOICE_ACTIVITY_HOLD_MS = 450;
export const VOICE_INTERRUPTED_HOLD_MS = 1_500;

export const VOICE_PHASE_LABELS: Record<VoicePhase, string> = {
  idle: "Not connected",
  connecting: "Connecting",
  listening: "Listening",
  user_speaking: "You are speaking",
  delegating: "Looking it up",
  assistant_speaking: "Assistant speaking",
  interrupted: "Interrupted",
  reconnecting: "Reconnecting",
  control_lost: "ChatAI control unavailable · muted",
  error: "Connection problem",
  ended: "Ended",
};

function recent(at: number | null, now: number, windowMs: number) {
  return at !== null && now - at < windowMs;
}

export function isUserActive(signals: VoiceSignals) {
  return recent(signals.userVoiceAt, signals.now, VOICE_ACTIVITY_HOLD_MS);
}

export function isAssistantActive(signals: VoiceSignals) {
  return recent(signals.assistantVoiceAt, signals.now, VOICE_ACTIVITY_HOLD_MS);
}

/**
 * Priority: interrupted > user speaking > delegating > assistant speaking > listening.
 * Delegating outranks assistant audio because GPT-Live may speak filler while ChatAI
 * retrieves; that filler is not the grounded answer.
 */
export function deriveVoicePhase(signals: VoiceSignals): VoicePhase {
  switch (signals.connection) {
    case "idle":
      return "idle";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "degraded":
      return "control_lost";
    case "failed":
      return "error";
    case "ended":
      return "ended";
    case "connected":
      break;
  }
  if (recent(signals.interruptedAt, signals.now, VOICE_INTERRUPTED_HOLD_MS)) return "interrupted";
  if (isUserActive(signals)) return "user_speaking";
  if (signals.delegationActive) return "delegating";
  if (isAssistantActive(signals)) return "assistant_speaking";
  return "listening";
}

/** User speech starting while the assistant is audible counts as a barge-in. */
export function detectInterruption(input: {
  userWasActive: boolean;
  userIsActive: boolean;
  assistantIsActive: boolean;
}) {
  return !input.userWasActive && input.userIsActive && input.assistantIsActive;
}

export function isPlaygroundVoiceActive(connection: VoiceConnection) {
  return (
    connection === "connecting" ||
    connection === "connected" ||
    connection === "reconnecting" ||
    connection === "degraded"
  );
}

/** Owner-facing copy for a call ChatAI ended itself (end endpoint or heartbeat `endReason`). */
export function voiceEndNotice(endReason: unknown): string | null {
  switch (endReason) {
    case "usage_limit":
      return "The call ended because this account's Voice minutes for the current period are used up.";
    case "superseded":
      return "The call ended because a newer Voice session started.";
    case "idle":
      return "The call ended after a period of silence (idle timeout).";
    case "max_duration":
      return "The call reached the maximum Voice session length.";
    case "heartbeat_lost":
      return "The call ended because ChatAI stopped receiving this browser's heartbeats.";
    case "control_lost":
      return "The call ended because ChatAI lost control of the provider session (sideband could not re-attach).";
    case "disconnected":
      return "The call ended because the connection to ChatAI was lost.";
    case "shutdown":
      return "The call ended because the ChatAI server shut down or restarted (graceful drain). Start a new call when it is back.";
    default:
      return null;
  }
}

export const VOICE_END_NOTICE_DISCONNECTED = voiceEndNotice("disconnected")!;

/** Owner copy when this browser ended the call after control stayed unreachable. */
export const CONTROL_GRACE_EXPIRED_NOTICE =
  "The call ended because ChatAI control stayed unreachable for 20 seconds; audio was muted meanwhile.";
export const CONTROL_SESSION_LOST_NOTICE =
  "The call ended because ChatAI no longer has this session (runtime lost); the provider session is being closed.";

export type OwnerControlView = {
  /** Browser-side control health. */
  health: "healthy" | "suspect" | "reconnecting" | "closing" | "terminated";
  heartbeatFailures: number;
  /** Last heartbeat was answered 421 (another instance owns the runtime). */
  misrouted: boolean;
  /** Owner snapshot: sideband state on the server. */
  sideband: { state: "attached" | "reattaching" | "lost"; attempts: number; lastGapMs: number | null; possibleLoss: boolean } | null;
};

/** Operational detail for the owner; ids and numbers only, never secrets or transcript. */
export function ownerControlDetail(view: OwnerControlView): string | null {
  const parts: string[] = [];
  if (view.health === "suspect") parts.push("Heartbeat missed; watching");
  if (view.health === "reconnecting") {
    parts.push(
      `ChatAI control unavailable: mic and assistant muted${view.heartbeatFailures ? ` (${view.heartbeatFailures} failed heartbeat${view.heartbeatFailures === 1 ? "" : "s"})` : ""}`,
    );
  }
  if (view.health === "closing") parts.push("ChatAI lost this session; waiting for the provider to close");
  if (view.misrouted) parts.push("Heartbeat reached another instance (421); not treated as control loss");
  if (view.sideband) {
    const { state, attempts, lastGapMs, possibleLoss } = view.sideband;
    if (state === "reattaching") parts.push(`Sideband re-attaching (attempt ${attempts})`);
    if (state === "lost") parts.push("Sideband lost");
    if (state === "attached" && attempts > 0) {
      parts.push(
        `Sideband re-attached after ${attempts} attempt${attempts === 1 ? "" : "s"}${lastGapMs !== null ? ` · ${Math.round(lastGapMs)} ms gap` : ""}${possibleLoss ? " · events may have been missed" : ""}`,
      );
    }
  }
  return parts.length ? parts.join(" · ") : null;
}
