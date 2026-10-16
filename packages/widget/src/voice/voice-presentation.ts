import {
  isVoiceActive,
  type WidgetVoiceState,
} from "@nightzeros/chatai-widget-core";

/** CSS/motion token for the orb sphere (not the controller phase). */
export type VoiceMotion =
  | "static"
  | "pending"
  | "listening"
  | "hearing"
  | "processing"
  | "speaking"
  | "settle";

export type VoicePresentation = {
  status: string;
  motion: VoiceMotion;
  canStart: boolean;
  canEnd: boolean;
  canMute: boolean;
  canToggleCaptions: boolean;
  canRetry: boolean;
  /** Dismiss error/notice and return to text chat. */
  canDismiss: boolean;
  errorMessage?: string;
  notice?: string;
  meta: string;
  microphoneMuted: boolean;
  consentPending: boolean;
};

function voiceMeta(voice: WidgetVoiceState): string {
  if (voice.mock) return "Test mode · no audio";
  if (voice.ephemeral) return "Not saved";
  const parts = [
    voice.recording ? "Recording" : "",
    voice.transcriptSaved === false ? "Voice transcript not saved" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Whether Orb (or Dock) should replace the transcript/composer with the voice stage.
 * Classic keeps its own VoiceBar and never uses this for layout.
 */
export function voiceStageVisible(voice: WidgetVoiceState): boolean {
  if (voice.consentPending) return true;
  if (isVoiceActive(voice.connection)) return true;
  if (voice.connection === "failed") return true;
  if (voice.connection === "ended") return true;
  return false;
}

/**
 * Pure phase → copy/motion/control flags for Orb/Dock.
 * Visitor mute overrides the status line while the session is otherwise connected.
 */
export function presentVoice(voice: WidgetVoiceState): VoicePresentation {
  const active = isVoiceActive(voice.connection);
  const failed = voice.connection === "failed";
  const ended = voice.connection === "ended";
  const consentPending = Boolean(voice.consentPending);
  const microphoneMuted = Boolean(voice.microphoneMuted);
  const meta = voiceMeta(voice);

  if (consentPending) {
    return {
      status: "This voice conversation is recorded",
      motion: "static",
      canStart: false,
      canEnd: false,
      canMute: false,
      canToggleCaptions: false,
      canRetry: false,
      canDismiss: true,
      meta,
      microphoneMuted: false,
      consentPending: true,
    };
  }

  if (failed) {
    return {
      status: "Voice stopped",
      motion: "static",
      canStart: false,
      canEnd: false,
      canMute: false,
      canToggleCaptions: false,
      canRetry: voice.error?.code !== "unsupported",
      canDismiss: true,
      errorMessage: voice.error?.message,
      meta,
      microphoneMuted: false,
      consentPending: false,
    };
  }

  if (ended) {
    return {
      status: "Voice ended",
      motion: "static",
      canStart: true,
      canEnd: false,
      canMute: false,
      canToggleCaptions: true,
      canRetry: false,
      canDismiss: true,
      notice: voice.notice,
      meta,
      microphoneMuted: false,
      consentPending: false,
    };
  }

  if (!active) {
    return {
      status: "Ready when you are",
      motion: "static",
      canStart: true,
      canEnd: false,
      canMute: false,
      canToggleCaptions: true,
      canRetry: false,
      canDismiss: true,
      meta,
      microphoneMuted: false,
      consentPending: false,
    };
  }

  let status: string;
  let motion: VoiceMotion;
  switch (voice.phase) {
    case "requesting_mic":
      status = "Allow microphone access";
      motion = "static";
      break;
    case "connecting":
      status = "Connecting…";
      motion = "pending";
      break;
    case "listening":
      status = "I’m listening";
      motion = "listening";
      break;
    case "user_speaking":
      status = "Hearing you";
      motion = "hearing";
      break;
    case "processing":
      status = "Looking that up…";
      motion = "processing";
      break;
    case "assistant_speaking":
      status = "Speaking";
      motion = "speaking";
      break;
    case "interrupted":
      status = "Interrupted — go ahead";
      motion = "settle";
      break;
    case "reconnecting":
      status = "Reconnecting…";
      motion = "static";
      break;
    default:
      status = "I’m listening";
      motion = "listening";
  }

  if (microphoneMuted && voice.connection === "connected") {
    status = "Microphone muted";
  }

  return {
    status,
    motion,
    canStart: false,
    canEnd: true,
    canMute: voice.connection === "connected" || voice.connection === "reconnecting",
    canToggleCaptions: true,
    canRetry: false,
    canDismiss: false,
    meta,
    microphoneMuted,
    consentPending: false,
  };
}
