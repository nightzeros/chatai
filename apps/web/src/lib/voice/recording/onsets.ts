import { SOURCE_RATE } from "./timeline";

const SAMPLES_PER_MS = SOURCE_RATE / 1000;
export const ONSET_WINDOW_MS = 10;
const WINDOW_SAMPLES = ONSET_WINDOW_MS * SAMPLES_PER_MS;
/** Quiet time required before an energy rise counts as a new speech stretch. */
export const ONSET_SILENCE_MS = 300;
/** Windows kept to find where the energy started rising before a detected onset. */
const SOFT_LOOKBACK_WINDOWS = ONSET_SILENCE_MS / ONSET_WINDOW_MS;
/** Reported pause lengths are capped (anything longer is simply "a long pause"). */
const MAX_QUIET_MS = 60_000;

/**
 * One stretch of audible speech on a timeline: it starts after at least
 * ONSET_SILENCE_MS of quiet and runs until the next such pause.
 */
export type SpeechRun = {
  /** Detected onset (first loud 10 ms window). */
  startMs: number;
  /** End of the last loud window so far. */
  endMs: number;
  /** Quiet (or unobserved) time before the onset, capped. */
  quietBeforeMs: number;
  /** How long the energy was already rising (above half the loud threshold) before the onset. */
  leadMs: number;
};

/**
 * Energy-based speech onset detector over positioned PCM (24 kHz mono). Keeps
 * only numbers: a few 10 ms window energies and the detected speech runs.
 * Loud means rms above max(200, 4 × adaptive noise floor).
 */
export class OnsetTracker {
  private floor: number | null = null;
  private quietMs = ONSET_SILENCE_MS;
  private carry = new Int16Array(0);
  private carryStart = 0;
  private nextPos: number | null = null;
  private recent: Array<{ pos: number; rms: number }> = [];
  private readonly list: SpeechRun[] = [];

  constructor(private readonly maxRuns = 400) {}

  /** Detected speech runs in timeline order (bounded, oldest dropped). */
  get runs(): readonly SpeechRun[] {
    return this.list;
  }

  /**
   * Feed audio positioned at `startSample`. A jump forward (unobserved time)
   * counts as quiet; overlapping or backward positions are processed as given.
   */
  feed(pcm: Int16Array, startSample: number, onLoud?: (ms: number) => void): void {
    let buf = pcm;
    let bufStart = startSample;
    if (this.nextPos !== null && startSample > this.nextPos) {
      this.quietMs = Math.min(MAX_QUIET_MS, this.quietMs + (startSample - this.nextPos) / SAMPLES_PER_MS);
      this.carry = new Int16Array(0);
      this.recent = [];
    } else if (this.carry.length > 0 && this.carryStart + this.carry.length === startSample) {
      buf = new Int16Array(this.carry.length + pcm.length);
      buf.set(this.carry);
      buf.set(pcm, this.carry.length);
      bufStart = this.carryStart;
    }
    let i = 0;
    for (; i + WINDOW_SAMPLES <= buf.length; i += WINDOW_SAMPLES) {
      const pos = bufStart + i;
      const rms = windowRms(buf, i);
      // Follows quieter windows immediately, so a floor seeded by loud first audio recovers.
      this.floor = this.floor === null ? rms : Math.min(this.floor, rms);
      const threshold = Math.max(200, this.floor * 4);
      const loud = rms > threshold;
      const ms = pos / SAMPLES_PER_MS;
      if (loud) {
        if (this.quietMs >= ONSET_SILENCE_MS || this.list.length === 0) {
          const soft = this.softStart(pos, threshold);
          this.list.push({
            startMs: Math.round(ms),
            endMs: Math.round(ms + ONSET_WINDOW_MS),
            quietBeforeMs: Math.round(this.quietMs),
            leadMs: Math.round((pos - soft) / SAMPLES_PER_MS),
          });
          if (this.list.length > this.maxRuns) this.list.shift();
        } else {
          this.list.at(-1)!.endMs = Math.round(ms + ONSET_WINDOW_MS);
        }
        this.quietMs = 0;
        onLoud?.(ms);
      } else {
        this.quietMs = Math.min(MAX_QUIET_MS, this.quietMs + ONSET_WINDOW_MS);
        this.floor = this.floor * 0.98 + rms * 0.02;
      }
      this.recent.push({ pos, rms });
      if (this.recent.length > SOFT_LOOKBACK_WINDOWS) this.recent.shift();
    }
    this.carry = buf.slice(i);
    this.carryStart = bufStart + i;
    this.nextPos = Math.max(this.nextPos ?? 0, bufStart + buf.length);
  }

  /** Earliest of the contiguous preceding windows above half the loud threshold. */
  private softStart(onsetPos: number, loudThreshold: number): number {
    const soft = loudThreshold / 2;
    let start = onsetPos;
    for (let i = this.recent.length - 1; i >= 0; i -= 1) {
      const w = this.recent[i]!;
      if (w.pos !== start - WINDOW_SAMPLES || w.rms < soft) break;
      start = w.pos;
    }
    return start;
  }
}

function windowRms(pcm: Int16Array, from: number): number {
  let sum = 0;
  for (let i = from; i < from + WINDOW_SAMPLES; i += 1) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / WINDOW_SAMPLES);
}
