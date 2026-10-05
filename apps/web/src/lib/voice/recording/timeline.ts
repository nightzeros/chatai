/** Reflected audio rate (mono PCM16) and the recorder's 20 ms frame. */
export const SOURCE_RATE = 24_000;
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SOURCE_RATE * FRAME_MS) / 1000; // 480

/** Audio newer than this stays buffered so late/out-of-order deltas can still be placed. */
export const DEFAULT_LAG_MS = 1_500;
/** Visitor audio arriving this far behind wall-clock is treated as a gap (silence inserted). */
const INPUT_GAP_MS = 500;
/** Assistant audio claiming a position further ahead than this is dropped (bounded memory). */
const MAX_AHEAD_MS = 30_000;

const SAMPLES_PER_MS = SOURCE_RATE / 1000;

export type StereoFrame = { left: Int16Array; right: Int16Array };

type Slot = { left: Int16Array | null; right: Int16Array | null };

/**
 * Places reflected audio on one timeline and emits time-aligned 20 ms stereo frames:
 * visitor (input) on the left, assistant (output) on the right, silence in gaps.
 *
 * Time zero is the provider session timeline origin, which the first reflected
 * visitor audio marks. Visitor audio is placed by arrival order (it has no
 * timestamps); assistant audio by its provider `startMs`. Nothing is kept beyond
 * the lag window plus a bounded look-ahead.
 */
export class StereoTimeline {
  private readonly slots = new Map<number, Slot>();
  /** Wall-clock ms of timeline position 0; null until the first audio arrives. */
  private originWall: number | null = null;
  private inputPos = 0;
  private outputCursor = 0;
  private emitted = 0;
  private maxWritten = 0;
  droppedSamples = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly lagMs: number = DEFAULT_LAG_MS,
  ) {}

  /** Emitted duration so far. */
  get emittedMs(): number {
    return this.emitted * FRAME_MS;
  }

  pushInput(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const now = this.now();
    if (this.originWall === null) this.originWall = now - pcm.length / SAMPLES_PER_MS;
    const expected = Math.round((now - this.originWall) * SAMPLES_PER_MS) - pcm.length;
    if (expected - this.inputPos > INPUT_GAP_MS * SAMPLES_PER_MS) this.inputPos = expected;
    this.inputPos = Math.max(this.inputPos, this.emitted * FRAME_SAMPLES);
    this.write("left", this.inputPos, pcm);
    this.inputPos += pcm.length;
  }

  pushOutput(pcm: Int16Array, startMs: number | null): void {
    if (pcm.length === 0) return;
    const now = this.now();
    if (this.originWall === null) this.originWall = now - (startMs ?? 0);
    const wallPos = Math.round((now - this.originWall) * SAMPLES_PER_MS);
    let start =
      startMs !== null
        ? Math.round(startMs * SAMPLES_PER_MS)
        : Math.max(this.outputCursor, wallPos - pcm.length);
    if (start > wallPos + MAX_AHEAD_MS * SAMPLES_PER_MS) {
      this.droppedSamples += pcm.length;
      return;
    }
    // Late delta (its slot was already emitted): keep the speech, shift it forward.
    start = Math.max(start, this.emitted * FRAME_SAMPLES);
    this.write("right", start, pcm);
    this.outputCursor = start + pcm.length;
  }

  /** Frames whose end is older than the lag window. */
  drainReady(): StereoFrame[] {
    if (this.originWall === null) return [];
    const ready = Math.floor(
      ((this.now() - this.originWall - this.lagMs) * SAMPLES_PER_MS) / FRAME_SAMPLES,
    );
    return this.drainUntil(ready);
  }

  /**
   * Final flush at session end: everything written up to now. Assistant audio
   * positioned after "now" was never played to the visitor and is discarded.
   */
  drainAll(): StereoFrame[] {
    if (this.originWall === null) return [];
    const wallFrames = Math.ceil(
      ((this.now() - this.originWall) * SAMPLES_PER_MS) / FRAME_SAMPLES,
    );
    const writtenFrames = Math.ceil(this.maxWritten / FRAME_SAMPLES);
    const frames = this.drainUntil(Math.min(wallFrames, writtenFrames));
    this.slots.clear();
    return frames;
  }

  private drainUntil(frameCount: number): StereoFrame[] {
    const out: StereoFrame[] = [];
    while (this.emitted < frameCount) {
      const slot = this.slots.get(this.emitted);
      this.slots.delete(this.emitted);
      out.push({
        left: slot?.left ?? new Int16Array(FRAME_SAMPLES),
        right: slot?.right ?? new Int16Array(FRAME_SAMPLES),
      });
      this.emitted += 1;
    }
    return out;
  }

  private write(side: "left" | "right", start: number, pcm: Int16Array): void {
    let offset = 0;
    while (offset < pcm.length) {
      const pos = start + offset;
      const frame = Math.floor(pos / FRAME_SAMPLES);
      const within = pos - frame * FRAME_SAMPLES;
      const count = Math.min(FRAME_SAMPLES - within, pcm.length - offset);
      let slot = this.slots.get(frame);
      if (!slot) {
        slot = { left: null, right: null };
        this.slots.set(frame, slot);
      }
      const target = slot[side] ?? (slot[side] = new Int16Array(FRAME_SAMPLES));
      target.set(pcm.subarray(offset, offset + count), within);
      offset += count;
    }
    this.maxWritten = Math.max(this.maxWritten, start + pcm.length);
  }
}

/**
 * Streaming 2x upsampler (24 → 48 kHz) for one channel: original samples pass
 * through, midpoints use a 4-tap half-band interpolator. Fixed 2-sample delay,
 * identical on both channels, so stereo alignment is unaffected.
 */
export class Upsampler2x {
  private a = 0;
  private b = 0;
  private c = 0;

  /** Writes 2 * input.length floats into `out` at `stride` spacing starting at `offset`. */
  process(input: Int16Array, out: Float32Array, offset: number, stride: number): void {
    let o = offset;
    for (let i = 0; i < input.length; i += 1) {
      const d = input[i]! / 32768;
      out[o] = this.b;
      o += stride;
      out[o] = (-this.a + 9 * this.b + 9 * this.c - d) / 16;
      o += stride;
      this.a = this.b;
      this.b = this.c;
      this.c = d;
    }
  }
}
