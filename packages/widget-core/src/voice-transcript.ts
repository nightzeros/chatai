/**
 * Builds the visible Voice transcript from realtime transcript deltas.
 *
 * Input and output deltas share one provider timeline (`start_ms`/`end_ms`), so
 * speech that starts before the assistant's audio has ended overlaps it. Overlapping
 * speech shorter than BARGE_IN_MIN_WORDS ("mm-hm") is a backchannel and never becomes
 * a turn; the ChatAI server applies the same threshold before it treats speech as a
 * barge-in. Longer overlapping speech interrupts the assistant turn.
 */
export const BARGE_IN_MIN_WORDS = 2;

export type VoiceTranscriptTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  interrupted: boolean;
};

type Pending = { text: string; startMs: number };

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function createVoiceTranscript(idPrefix: string) {
  const turns: VoiceTranscriptTurn[] = [];
  let pending: Pending | null = null;
  let assistantEndMs = Number.NEGATIVE_INFINITY;
  let counter = 0;

  const push = (role: VoiceTranscriptTurn["role"], text: string) => {
    turns.push({ id: `${idPrefix}:${counter++}`, role, text, interrupted: false });
  };

  const commitPending = () => {
    if (!pending) return;
    const last = turns.at(-1);
    if (last?.role === "assistant") last.interrupted = true;
    push("user", pending.text);
    pending = null;
  };

  return {
    input(delta: string, startMs: number) {
      if (!delta) return;
      const last = turns.at(-1);
      if (pending) {
        if (startMs >= assistantEndMs && pending.startMs < assistantEndMs && words(pending.text) < BARGE_IN_MIN_WORDS) {
          // The overlap was a backchannel; this is a new turn after the assistant finished.
          pending = null;
          push("user", delta);
          return;
        }
        pending.text += delta;
        if (words(pending.text) >= BARGE_IN_MIN_WORDS) commitPending();
        return;
      }
      if (last?.role === "user") {
        last.text += delta;
        return;
      }
      if (last?.role === "assistant" && startMs < assistantEndMs) {
        pending = { text: delta, startMs };
        if (words(pending.text) >= BARGE_IN_MIN_WORDS) commitPending();
        return;
      }
      push("user", delta);
    },
    output(delta: string, endMs: number) {
      if (!delta) return;
      // The assistant kept talking over short speech: that speech was a backchannel.
      pending = null;
      assistantEndMs = Math.max(assistantEndMs, endMs);
      const last = turns.at(-1);
      if (last?.role === "assistant") {
        last.text += delta;
        return;
      }
      push("assistant", delta);
    },
    /** Committed turns in spoken order (copies). */
    turns(): VoiceTranscriptTurn[] {
      return turns
        .filter((turn) => turn.text.trim())
        .map((turn) => ({ ...turn, text: turn.text.trim() }));
    },
    /** Ends the transcript; short speech still overlapping the assistant is dropped. */
    finish(): VoiceTranscriptTurn[] {
      pending = null;
      return this.turns();
    },
  };
}

export type VoiceTranscript = ReturnType<typeof createVoiceTranscript>;
