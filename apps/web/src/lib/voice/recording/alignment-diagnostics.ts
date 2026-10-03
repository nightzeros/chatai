import type { ReflectedAudioFrame } from "@chatai/voice";

import { ONSET_WINDOW_MS, OnsetTracker, type SpeechRun } from "./onsets";
import { SOURCE_RATE } from "./timeline";

const SAMPLES_PER_MS = SOURCE_RATE / 1000;
/** Transcript fragments starting this long after the previous one's end begin a new utterance. */
const UTTERANCE_GAP_MS = 1_000;
/** Mirrors the V1 StereoTimeline's INPUT_GAP_MS. */
const RECORDER_GAP_MS = 500;
/** Audible assistant windows closer than this belong to one continuous speaking stretch. */
const OUTPUT_JOIN_MS = 500;
/** Input arriving this soon after a re-attach is the provider's backlog flush. */
const REATTACH_BURST_MS = 250;
const MAX_TURNS = 40;
const MAX_OUTPUT_SPANS = 200;
const MAX_REATTACHES = 10;

type UtteranceStarts = { lastEndMs: number | null; starts: number[] };

function noteFragment(u: UtteranceStarts, startMs: number, endMs: number): void {
  if (u.lastEndMs === null || startMs - u.lastEndMs >= UTTERANCE_GAP_MS) {
    if (u.starts.length < MAX_TURNS) u.starts.push(startMs);
  }
  u.lastEndMs = Math.max(u.lastEndMs ?? endMs, endMs);
}

export type AlignmentTurn = {
  transcriptStartMs: number;
  audioOnsetMs: number | null;
  /** transcriptStartMs − audioOnsetMs; positive means the transcript stamp is late. */
  biasMs: number | null;
  /** How long before the detected onset the energy was already rising (preroll input). */
  onsetLeadMs: number | null;
  /** Visitor turns only: began while assistant audio was playing. */
  bargeIn?: boolean;
};

export type AlignmentReattach = {
  gapMs: number;
  /** Reflected visitor audio received so far when the sideband came back. */
  atReflectedMs: number;
  /** Visitor audio flushed in the burst right after re-attach (provider backlog). */
  burstInputMs: number;
  /** First provider output after re-attach: output end_ms minus reflected-input position. */
  outputLeadAfterMs: number | null;
  /** Same, against the recorder's visitor write position. */
  recorderSkewAfterMs: number | null;
};

export type AlignmentSummary = {
  firstInputAfterMintMs: number | null;
  reflectedInputMs: number;
  lastProviderEndMs: number | null;
  recorderGapInserts: number;
  recorderGapInsertedMs: number;
  /** Provider output end_ms minus reflected-input position at arrival (provider clock vs reflected clock). */
  outputLeadMs: { min: number; max: number } | null;
  /** Provider output end_ms minus the recorder's visitor write position (misalignment the recorder adds). */
  recorderSkewMs: { min: number; max: number } | null;
  visitorTurns: AlignmentTurn[];
  assistantTurns: AlignmentTurn[];
  reattaches: AlignmentReattach[];
};

/**
 * Visitor transcript stamps trail the audio, so take the latest onset at or before
 * the stamp; assistant stamps lead it, so take the first onset at or after.
 */
function matchTurns(
  starts: number[],
  runs: readonly SpeechRun[],
  source: "input" | "output",
): AlignmentTurn[] {
  return starts.map((transcriptStartMs) => {
    const onset =
      source === "input"
        ? runs.findLast((r) => r.startMs <= transcriptStartMs + 200 && r.startMs >= transcriptStartMs - 2_500)
        : runs.find((r) => r.startMs >= transcriptStartMs - 200 && r.startMs <= transcriptStartMs + 1_500);
    return {
      transcriptStartMs,
      audioOnsetMs: onset?.startMs ?? null,
      biasMs: onset ? transcriptStartMs - onset.startMs : null,
      onsetLeadMs: onset?.leadMs ?? null,
    };
  });
}

function widen(range: { min: number; max: number } | null, value: number) {
  return range
    ? { min: Math.min(range.min, value), max: Math.max(range.max, value) }
    : { min: value, max: value };
}

/**
 * Numbers-only recording/provider clock diagnostics (VOICE_ALIGNMENT_DIAGNOSTICS=1).
 * Observes the same reflected audio and transcript timing as the recorder; never
 * retains audio beyond a few 10 ms window energies and never sees transcript text.
 */
export class AlignmentDiagnostics {
  private firstInputWall: number | null = null;
  private recorderOrigin: number | null = null;
  private reflectedSamples = 0;
  private recorderPos = 0;
  private gapInserts = 0;
  private gapInsertedSamples = 0;
  private lastProviderEndMs: number | null = null;
  private outputLead: { min: number; max: number } | null = null;
  private recorderSkew: { min: number; max: number } | null = null;
  private readonly input = new OnsetTracker();
  private readonly output = new OnsetTracker();
  private readonly inputUtterances: UtteranceStarts = { lastEndMs: null, starts: [] };
  private readonly outputUtterances: UtteranceStarts = { lastEndMs: null, starts: [] };
  private readonly outputSpans: Array<{ startMs: number; endMs: number }> = [];
  private readonly reattaches: AlignmentReattach[] = [];
  private reattachWall: number | null = null;
  private detached: AlignmentReattach | null = null;
  private awaitingOutputAfterReattach: AlignmentReattach | null = null;

  constructor(
    private readonly mintedAtWall: number,
    private readonly now: () => number = Date.now,
  ) {}

  onAudio(frame: ReflectedAudioFrame): void {
    const len = frame.pcm.length;
    if (len === 0) return;
    const now = this.now();
    if (frame.source === "input") {
      if (this.firstInputWall === null) {
        this.firstInputWall = now;
        this.recorderOrigin = now - len / SAMPLES_PER_MS;
      }
      const expected = Math.round((now - this.recorderOrigin!) * SAMPLES_PER_MS) - len;
      if (expected - this.recorderPos > RECORDER_GAP_MS * SAMPLES_PER_MS) {
        this.gapInserts += 1;
        this.gapInsertedSamples += expected - this.recorderPos;
        this.recorderPos = expected;
      }
      if (this.detached || (this.reattachWall !== null && now - this.reattachWall <= REATTACH_BURST_MS)) {
        const last = this.reattaches.at(-1);
        if (last) last.burstInputMs += Math.round(len / SAMPLES_PER_MS);
      }
      this.input.feed(frame.pcm, this.reflectedSamples);
      this.reflectedSamples += len;
      this.recorderPos += len;
      return;
    }
    if (frame.startMs === null) return;
    const endMs = frame.endMs ?? frame.startMs + len / SAMPLES_PER_MS;
    this.lastProviderEndMs = Math.max(this.lastProviderEndMs ?? endMs, endMs);
    if (this.firstInputWall !== null) {
      const lead = Math.round(endMs - this.reflectedSamples / SAMPLES_PER_MS);
      const skew = Math.round(endMs - this.recorderPos / SAMPLES_PER_MS);
      this.outputLead = widen(this.outputLead, lead);
      this.recorderSkew = widen(this.recorderSkew, skew);
      if (this.awaitingOutputAfterReattach) {
        this.awaitingOutputAfterReattach.outputLeadAfterMs = lead;
        this.awaitingOutputAfterReattach.recorderSkewAfterMs = skew;
        this.awaitingOutputAfterReattach = null;
      }
    }
    this.output.feed(frame.pcm, Math.round(frame.startMs * SAMPLES_PER_MS), (ms) =>
      this.noteAudibleOutput(ms),
    );
  }

  onTranscript(source: "input" | "output", startMs: number, endMs: number): void {
    noteFragment(source === "input" ? this.inputUtterances : this.outputUtterances, startMs, endMs);
    this.lastProviderEndMs = Math.max(this.lastProviderEndMs ?? endMs, endMs);
  }

  /** The sideband dropped; audio arriving until re-attach + a short window is the backlog burst. */
  onDisconnected(): void {
    if (this.detached || this.reattaches.length >= MAX_REATTACHES) return;
    this.detached = {
      gapMs: 0,
      atReflectedMs: Math.round(this.reflectedSamples / SAMPLES_PER_MS),
      burstInputMs: 0,
      outputLeadAfterMs: null,
      recorderSkewAfterMs: null,
    };
    this.reattaches.push(this.detached);
  }

  /** The sideband came back after `gapMs` without it. */
  onReattached(gapMs: number): void {
    const record = this.detached;
    if (!record) return;
    record.gapMs = Math.round(gapMs);
    this.detached = null;
    this.reattachWall = this.now();
    this.awaitingOutputAfterReattach = record;
  }

  summary(): AlignmentSummary {
    const assistantSpeaking = (ms: number) =>
      this.outputSpans.some((span) => ms >= span.startMs && ms <= span.endMs);
    return {
      firstInputAfterMintMs:
        this.firstInputWall === null ? null : Math.round(this.firstInputWall - this.mintedAtWall),
      reflectedInputMs: Math.round(this.reflectedSamples / SAMPLES_PER_MS),
      lastProviderEndMs: this.lastProviderEndMs,
      recorderGapInserts: this.gapInserts,
      recorderGapInsertedMs: Math.round(this.gapInsertedSamples / SAMPLES_PER_MS),
      outputLeadMs: this.outputLead,
      recorderSkewMs: this.recorderSkew,
      visitorTurns: matchTurns(this.inputUtterances.starts, this.input.runs, "input").map((turn) => ({
        ...turn,
        bargeIn: assistantSpeaking(turn.audioOnsetMs ?? turn.transcriptStartMs),
      })),
      assistantTurns: matchTurns(this.outputUtterances.starts, this.output.runs, "output"),
      reattaches: this.reattaches.map((r) => ({ ...r })),
    };
  }

  /** GPT-Live streams output frames through silence too, so only audible windows count as speaking. */
  private noteAudibleOutput(ms: number): void {
    const endMs = ms + ONSET_WINDOW_MS;
    const last = this.outputSpans.at(-1);
    if (last && ms <= last.endMs + OUTPUT_JOIN_MS && ms >= last.startMs) {
      last.endMs = Math.max(last.endMs, endMs);
      return;
    }
    this.outputSpans.push({ startMs: ms, endMs });
    if (this.outputSpans.length > MAX_OUTPUT_SPANS) this.outputSpans.shift();
  }
}
