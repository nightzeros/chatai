/**
 * Widget Voice state machine.
 *
 * `connection` is the lifecycle the controller drives; `phase` is what the visitor
 * sees, derived from connection + recent audio/transcript activity. The priority
 * order matches the owner playground: interrupted > user speaking > processing >
 * assistant speaking > listening.
 */
export type VoiceConnection =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "connected"
  /** ChatAI control is unreachable: mic and assistant muted, media kept for recovery. */
  | "reconnecting"
  | "failed"
  | "ended";

export type VoicePhase =
  | "idle"
  | "requesting_mic"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "assistant_speaking"
  | "interrupted"
  | "reconnecting"
  | "error"
  | "ended";

export type VoiceSignals = {
  connection: VoiceConnection;
  now: number;
  /** Last time mic energy or an input transcript delta was observed. */
  userVoiceAt: number | null;
  /** Last time remote audio energy or an output transcript delta was observed. */
  assistantVoiceAt: number | null;
  /** ChatAI is looking something up for the current question. */
  processing: boolean;
  interruptedAt: number | null;
};

export const VOICE_ACTIVITY_HOLD_MS = 450;
export const VOICE_INTERRUPTED_HOLD_MS = 1_500;

export const VOICE_PHASE_LABELS: Record<VoicePhase, string> = {
  idle: "Voice is off",
  requesting_mic: "Allow microphone access",
  connecting: "Connecting…",
  listening: "Listening",
  user_speaking: "Hearing you",
  processing: "Looking that up…",
  assistant_speaking: "Speaking",
  interrupted: "Interrupted — go ahead",
  reconnecting: "Reconnecting…",
  error: "Voice stopped",
  ended: "Voice ended",
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
 * Processing outranks assistant audio because the realtime model may speak a short
 * filler while ChatAI retrieves; that filler is not the grounded answer.
 */
export function deriveVoicePhase(signals: VoiceSignals): VoicePhase {
  switch (signals.connection) {
    case "idle":
      return "idle";
    case "requesting_mic":
      return "requesting_mic";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "failed":
      return "error";
    case "ended":
      return "ended";
    case "connected":
      break;
  }
  if (recent(signals.interruptedAt, signals.now, VOICE_INTERRUPTED_HOLD_MS)) return "interrupted";
  if (isUserActive(signals)) return "user_speaking";
  if (signals.processing) return "processing";
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

export function isVoiceActive(connection: VoiceConnection) {
  return (
    connection === "requesting_mic" ||
    connection === "connecting" ||
    connection === "connected" ||
    connection === "reconnecting"
  );
}
