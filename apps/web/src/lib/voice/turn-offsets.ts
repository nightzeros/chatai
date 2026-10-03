import { MAX_AUDIO_OFFSET_MS, sanitizeAudioOffsetMs } from "./audio-offset";
import { ONSET_SILENCE_MS, type SpeechRun } from "./recording/onsets";

/**
 * Timeline V2 turn-offset rules, locked from the Phase 9E human-microphone
 * measurements (visitor transcript start trails speech by −120 to +1410 ms,
 * median ~580; assistant transcript start leads its audio by 280–580 ms).
 */
export const V2_TURN_TIMING = {
  /** Visitor onset search window around the first transcript fragment start. */
  visitorSearchBeforeMs: 2_500,
  visitorSearchAfterMs: 200,
  /** Pauses shorter than this inside the visitor's speech are walked back across. */
  visitorPauseBridgeMs: 600,
  /** Fallback only (no reliable onset): about the measured median transcript lag. */
  visitorFallbackLagMs: 600,
  /** Assistant onset search window around its transcript start. */
  assistantSearchBeforeMs: 200,
  assistantSearchAfterMs: 1_500,
} as const;

export type TurnOffsetRole = "user" | "assistant";

/**
 * Start of the visitor's speech for a turn whose first transcript fragment starts
 * at `stampMs`: the speech stretch containing the fragment (the latest onset at or
 * before the stamp, else the first one up to 200 ms after), walked back across
 * short pauses. Never before `boundaryMs` (the previous visitor turn) or the
 * search window, and the walk-back never crosses a `barriersMs` position (the
 * start of an assistant reply). Null when no onset qualifies.
 */
export function findVisitorOnsetMs(
  runs: readonly SpeechRun[],
  stampMs: number,
  boundaryMs: number,
  barriersMs: readonly number[] = [],
): number | null {
  const t = V2_TURN_TIMING;
  const lo = Math.max(stampMs - t.visitorSearchBeforeMs, boundaryMs, 0);
  const hi = stampMs + t.visitorSearchAfterMs;
  let i = runs.findLastIndex((run) => run.startMs <= stampMs && run.startMs >= lo);
  if (i < 0) i = runs.findIndex((run) => run.startMs > stampMs && run.startMs <= hi && run.startMs >= lo);
  if (i < 0) return null;
  while (i > 0 && runs[i]!.quietBeforeMs < t.visitorPauseBridgeMs) {
    const current = runs[i]!.startMs;
    const previous = runs[i - 1]!.startMs;
    if (previous < lo) break;
    if (barriersMs.some((barrier) => barrier > previous && barrier <= current)) break;
    i -= 1;
  }
  return runs[i]!.startMs;
}

/**
 * First audible assistant audio for a reply whose transcript starts at `stampMs`.
 * Null when there is none in the window, or when assistant speech is already in
 * progress at the window start (the reply's own start is then not observable).
 */
export function findAssistantOnsetMs(
  runs: readonly SpeechRun[],
  stampMs: number,
  boundaryMs: number,
): number | null {
  const t = V2_TURN_TIMING;
  const lo = Math.max(stampMs - t.assistantSearchBeforeMs, boundaryMs, 0);
  const hi = stampMs + t.assistantSearchAfterMs;
  if (runs.some((run) => run.startMs < lo && run.endMs + ONSET_SILENCE_MS > lo)) return null;
  const run = runs.find((candidate) => candidate.startMs >= lo && candidate.startMs <= hi);
  return run ? run.startMs : null;
}

type ResolvedTurn = { role: TurnOffsetRole; stampMs: number; offsetMs: number };

export type TurnOffsetStats = {
  visitorOnset: number;
  visitorFallback: number;
  assistantOnset: number;
  assistantFallback: number;
};

/**
 * Per-session V2 offset resolver for a recorded call. Offsets are navigation
 * metadata only (never billing or usage). Each turn resolves once. Offsets are
 * monotonic per speaker in transcript order (never before the same speaker's
 * previous turn, never after its next one); visitor and assistant turns may
 * legitimately overlap (barge-in, simultaneous speech), and their transcript
 * stamps lag in opposite directions, so the other speaker's turns only bound the
 * visitor's pause bridging.
 */
export class VoiceTurnOffsets {
  private readonly resolved: ResolvedTurn[] = [];
  readonly stats: TurnOffsetStats = { visitorOnset: 0, visitorFallback: 0, assistantOnset: 0, assistantFallback: 0 };

  constructor(private readonly runs: () => { input: readonly SpeechRun[]; output: readonly SpeechRun[] } | null) {}

  resolve(role: TurnOffsetRole, transcriptStartMs: unknown): number | null {
    const stampMs = sanitizeAudioOffsetMs(transcriptStartMs);
    if (stampMs === null) return null;
    const cached = this.resolved.find((turn) => turn.role === role && turn.stampMs === stampMs);
    if (cached) return cached.offsetMs;

    let lower = 0;
    let upper = MAX_AUDIO_OFFSET_MS;
    for (const turn of this.resolved) {
      if (turn.role !== role) continue;
      if (turn.stampMs < stampMs) lower = Math.max(lower, turn.offsetMs);
      else if (turn.stampMs > stampMs) upper = Math.min(upper, turn.offsetMs);
    }

    const runs = this.runs();
    let offsetMs: number;
    if (role === "user") {
      const replyStarts = this.resolved.filter((turn) => turn.role === "assistant").map((turn) => turn.offsetMs);
      const onset = runs ? findVisitorOnsetMs(runs.input, stampMs, lower, replyStarts) : null;
      if (onset !== null) this.stats.visitorOnset += 1;
      else this.stats.visitorFallback += 1;
      offsetMs = onset ?? stampMs - V2_TURN_TIMING.visitorFallbackLagMs;
    } else {
      const onset = runs ? findAssistantOnsetMs(runs.output, stampMs, lower) : null;
      if (onset !== null) this.stats.assistantOnset += 1;
      else this.stats.assistantFallback += 1;
      offsetMs = onset ?? stampMs;
    }
    offsetMs = Math.round(Math.max(lower, Math.min(offsetMs, upper), 0));
    this.resolved.push({ role, stampMs, offsetMs });
    return offsetMs;
  }
}

/**
 * Offset to store for a Voice turn. Sessions with a V2 recording use the resolver;
 * everything else keeps the Phase 8 transcript offset. Never throws.
 */
export function voiceTurnOffsetMs(
  session: { turnOffsets?: VoiceTurnOffsets | null },
  role: TurnOffsetRole,
  transcriptStartMs: unknown,
): number | null {
  const resolver = session.turnOffsets;
  if (!resolver) return sanitizeAudioOffsetMs(transcriptStartMs);
  try {
    return sanitizeAudioOffsetMs(resolver.resolve(role, transcriptStartMs));
  } catch {
    return sanitizeAudioOffsetMs(transcriptStartMs);
  }
}
