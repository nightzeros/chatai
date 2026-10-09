import { isConversationalMessage } from "@chatai/rag/answer";

import type { VoiceRuntimeSession, VoiceTurn } from "./session-runtime";

/**
 * Server-authoritative Voice playback gate.
 *
 * GPT-Live gives the server no way to stop its speech, so the gate lives in the
 * browser's playback path: the widget keeps assistant audio and captions muted
 * unless the latest decision here is `open`. Only small talk may be answered by
 * the live model; every other utterance stays closed until ChatAI's backend
 * answer for it is appended.
 */

export type VoiceTurnClass = "social" | "backend";

export type VoiceGateReason =
  /** Session start: nothing has been approved yet. */
  | "start"
  /** Greeting, thanks, goodbye or a short acknowledgement: the live model may reply. */
  | "social"
  /** ChatAI's answer for the current turn was appended. */
  | "backend_answer"
  /** Server-initiated speech (idle check-in, limits, fallbacks). */
  | "system"
  /** The visitor is speaking again over approved speech. */
  | "user_speaking"
  /** A non-social utterance is waiting for the backend. */
  | "pending_backend"
  /** A social reply ran past the small-talk length budget. */
  | "reply_limit";

export type VoiceGateOpenReason = Extract<VoiceGateReason, "social" | "backend_answer" | "system">;

export type VoiceGateDecision = {
  seq: number;
  state: "open" | "closed";
  reason: VoiceGateReason;
  /**
   * Provider-timeline end of the latest input fragment when the decision was made.
   * Clients close locally on any input fragment starting after it.
   */
  inputEndMs: number | null;
};

/** null: the session ended and no further decisions follow. */
export type VoiceGateListener = (decision: VoiceGateDecision | null) => void;

/** The visitor speech the gate is currently deciding about. */
export type VoiceUtterance = {
  /** inputFragments index of the first fragment. */
  startIndex: number;
  lastIndex: number;
  firstStartMs: number;
  lastStartMs: number;
  lastEndMs: number;
  /** Wall clock of the latest fragment (quiet detection). */
  lastInputAt: number;
  kind: VoiceTurnClass;
  /** Turn answering this utterance (delegated or server-forced). */
  turn: VoiceTurn | null;
  /** Live reply words while open as social (small-talk budget). */
  socialReplyWords: number;
};

export type VoiceGateState = {
  decision: VoiceGateDecision;
  listeners: Set<VoiceGateListener>;
  ended: boolean;
  utterance: VoiceUtterance | null;
  forceTimer: ReturnType<typeof setTimeout> | null;
  forceDueAt: number | null;
  /** Wall clock of the latest output fragment that was withheld. */
  lastWithheldOutputAt: number | null;
  /** An approval that waits for withheld speech to stop (or for the approved speech to start). */
  pendingOpen: {
    reason: VoiceGateOpenReason;
    turn: VoiceTurn | null;
    timer: ReturnType<typeof setInterval> | null;
    startedAt: number;
  } | null;
  serverTurnSeq: number;
};

/** Short acknowledgements and closings GPT-Live may answer itself, on top of the shared small-talk list. */
const VOICE_ACKNOWLEDGEMENTS = [
  "thats all",
  "thats it",
  "that is all",
  "mm hmm",
  "uh huh",
  "mhm",
  "mmhmm",
  "mm",
  "mmm",
  "hmm",
  "yeah",
  "yep",
  "yup",
  "right",
  "sure",
].sort((a, b) => b.length - a.length);
const ACKNOWLEDGEMENT = new RegExp(
  `\\b(?:${VOICE_ACKNOWLEDGEMENTS.map((phrase) => phrase.replace(/ /g, "\\s+")).join("|")})\\b`,
  "g",
);
/** Same bound as the shared small-talk check; every word must still be a social phrase. */
const MAX_SOCIAL_WORDS = 12;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word is small talk: voice acknowledgements and closings, plus the shared phrases. */
function isVoiceSmallTalk(text: string): boolean {
  if (isConversationalMessage(text)) return true;
  const normalized = normalize(text).replace(/'/g, "");
  const rest = normalized.replace(ACKNOWLEDGEMENT, " ").replace(/\s+/g, " ").trim();
  if (normalized === "" || rest === normalized) return false;
  return rest === "" || isConversationalMessage(rest);
}

/**
 * Who may answer an utterance. Only greetings, thanks, goodbyes and short
 * acknowledgements are `social`; everything else (statements, single words,
 * feelings, "what do you mean?", requests to repeat, unclear speech) goes to
 * the backend. Any reply to an assistant question accepts or answers it, so it
 * is a backend turn too ("yes" after "Want to hear about our plans?").
 */
export function classifyVoiceTurn(text: string, lastAssistantText?: string | null): VoiceTurnClass {
  const trimmed = text.trim();
  if (!trimmed) return "backend";
  if (normalize(trimmed).split(" ").length > MAX_SOCIAL_WORDS) return "backend";
  if (lastAssistantText && /\?["')\s]*$/.test(lastAssistantText.trim())) return "backend";
  return isVoiceSmallTalk(trimmed) ? "social" : "backend";
}

export function voiceGateOf(session: VoiceRuntimeSession): VoiceGateState {
  session.gate ??= {
    decision: { seq: 0, state: "closed", reason: "start", inputEndMs: null },
    listeners: new Set(),
    ended: false,
    utterance: null,
    forceTimer: null,
    forceDueAt: null,
    lastWithheldOutputAt: null,
    pendingOpen: null,
    serverTurnSeq: 0,
  };
  return session.gate;
}

/** Output arriving now is withheld from the visitor (muted, captions hidden). */
export function isVoiceOutputWithheld(session: VoiceRuntimeSession): boolean {
  return session.gate ? session.gate.decision.state !== "open" : false;
}

function latestInputEndMs(session: VoiceRuntimeSession): number | null {
  return session.inputFragments.at(-1)?.endMs ?? null;
}

/**
 * Record and broadcast a decision. Staying closed is not re-sent (clients only act
 * on transitions and on each open's `inputEndMs`); every open is.
 */
export function setVoiceGate(
  session: VoiceRuntimeSession,
  state: VoiceGateDecision["state"],
  reason: VoiceGateReason,
): VoiceGateDecision {
  const gate = voiceGateOf(session);
  const inputEndMs = latestInputEndMs(session);
  const current = gate.decision;
  if (gate.ended) return current;
  if (state === "closed") cancelPendingOpen(gate);
  if (state === "closed" && current.state === "closed") {
    gate.decision = { ...current, reason, inputEndMs };
    return gate.decision;
  }
  if (current.state === state && current.reason === reason && current.inputEndMs === inputEndMs) {
    return current;
  }
  gate.decision = { seq: current.seq + 1, state, reason, inputEndMs };
  for (const listener of [...gate.listeners]) {
    try {
      listener(gate.decision);
    } catch {
      // A broken stream never affects the session or other listeners.
    }
  }
  return gate.decision;
}

export function cancelPendingOpen(gate: VoiceGateState): void {
  if (gate.pendingOpen?.timer) clearInterval(gate.pendingOpen.timer);
  gate.pendingOpen = null;
}

/** Subscribe to decisions (the caller reads `voiceGateOf(session).decision` for the current one). */
export function subscribeVoiceGate(session: VoiceRuntimeSession, listener: VoiceGateListener): () => void {
  const gate = voiceGateOf(session);
  if (gate.ended) {
    listener(null);
    return () => undefined;
  }
  gate.listeners.add(listener);
  return () => gate.listeners.delete(listener);
}

/** Session over: close, stop timers and end every stream. */
export function endVoiceGate(session: VoiceRuntimeSession): void {
  const gate = session.gate;
  if (!gate || gate.ended) return;
  if (gate.forceTimer) clearTimeout(gate.forceTimer);
  gate.forceTimer = null;
  gate.forceDueAt = null;
  cancelPendingOpen(gate);
  if (gate.decision.state !== "closed") {
    gate.decision = {
      seq: gate.decision.seq + 1,
      state: "closed",
      reason: "system",
      inputEndMs: gate.decision.inputEndMs,
    };
  }
  gate.ended = true;
  const listeners = [...gate.listeners];
  gate.listeners.clear();
  for (const listener of listeners) {
    try {
      listener(null);
    } catch {
      // Ignore: the stream is closing anyway.
    }
  }
}
