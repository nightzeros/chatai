import { toSpeakableCommentary, VOICE_ORCHESTRATION_DEFAULTS } from "./delegation-orchestrator";
import { insertVoiceWelcomeMessage } from "./persist";
import type { VoiceRuntimeSession } from "./session-runtime";
import { setVoiceGate, voiceGateOf } from "./turn-gate";

const welcomeCloseTimers = new WeakMap<VoiceRuntimeSession, ReturnType<typeof setTimeout>>();

/** Rough speak duration so the gate re-closes after the welcome, not mid-sentence. */
function welcomeCloseDelayMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(12_000, Math.max(1_800, words * 380));
}

function scheduleWelcomeGateClose(session: VoiceRuntimeSession, spoken: string): void {
  const prior = welcomeCloseTimers.get(session);
  if (prior) clearTimeout(prior);
  const timer = setTimeout(() => {
    welcomeCloseTimers.delete(session);
    const gate = session.gate;
    if (!gate || gate.ended) return;
    // User already took the floor, or a backend turn claimed the gate.
    if (gate.utterance) return;
    // Only re-close the welcome itself — never mute a social reply that opened during the delay.
    if (gate.decision.state === "open" && gate.decision.reason === "system") {
      setVoiceGate(session, "closed", "system");
    }
  }, welcomeCloseDelayMs(spoken));
  timer.unref?.();
  welcomeCloseTimers.set(session, timer);
}

/**
 * Server-driven spoken welcome after `session.started`.
 * Once per session after a successful speak (or a definitive empty welcome);
 * transient failures leave `welcomeSpoken` false so a later call can retry.
 */
export async function speakVoiceWelcome(session: VoiceRuntimeSession): Promise<void> {
  if (session.welcomeSpoken) return;

  const raw = session.assistant?.welcomeMessage?.trim() ?? "";
  if (!raw) {
    session.welcomeSpoken = true;
    return;
  }

  const speakable = toSpeakableCommentary(raw, VOICE_ORCHESTRATION_DEFAULTS.commentaryMaxChars);
  if (!speakable) {
    session.welcomeSpoken = true;
    return;
  }

  const channel = session.channel;
  if (!channel || session.terminating || session.status === "ending" || session.status === "ended") {
    return;
  }

  // Ensure the gate exists, then approve system speech for the welcome.
  voiceGateOf(session);
  setVoiceGate(session, "open", "system");

  const result = await channel.appendCommentary(null, speakable).catch(() => null);
  if (!result?.ok) {
    setVoiceGate(session, "closed", "system");
    return;
  }

  session.welcomeSpoken = true;
  session.history.push({ role: "assistant", content: speakable });
  void insertVoiceWelcomeMessage(session, speakable).catch(() => undefined);
  scheduleWelcomeGateClose(session, speakable);
}

/** Test helper: clear a pending welcome gate-close timer. */
export function clearWelcomeCloseTimerForTests(session: VoiceRuntimeSession): void {
  const prior = welcomeCloseTimers.get(session);
  if (prior) clearTimeout(prior);
  welcomeCloseTimers.delete(session);
}
