import { DEFAULT_LAG_MS, FRAME_SAMPLES, SOURCE_RATE, type StereoFrame } from "./timeline";

const SAMPLES_PER_MS = SOURCE_RATE / 1000;
/** Assistant audio claiming a position further ahead than this is dropped (bounded memory). */
const MAX_AHEAD_MS = 30_000;
/**
 * Visitor placement is re-anchored when trusted provider timing is this far ahead
 * of it (visitor audio was missed). Measured provider output ends at or before the
 * reflected visitor position (0 to −600 ms), so this never fires on normal flow.
 */
export const REANCHOR_TOLERANCE_MS = 400;
/** After a sideband re-attach, the backlog flush settles for this long before placement. */
export const REATTACH_SETTLE_MS = 750;
/** Held visitor audio is placed anyway once this much has accumulated. */
export const REATTACH_HOLD_MAX_MS = 8_000;

type Slot = { left: Int16Array | null; right: Int16Array | null };

export type TimelinePlacement = (side: "input" | "output", pcm: Int16Array, startSample: number) => void;

export type ProviderTimelineStats = {
  /** Visitor placement jumped forward to trusted provider timing (missed visitor audio). */
  reanchors: number;
  reanchoredMs: number;
  /** Held re-attach audio placed against a provider anchor / contiguously (no anchor). */
  anchoredReleases: number;
  contiguousReleases: number;
};

/**
 * Timeline version 2: places reflected audio on the provider media clock.
 *
 * - Visitor audio has no timestamps; its sample count is the provider clock (the
 *   provider clock pauses when no visitor media flows), so it is written
 *   contiguously. Wall-clock time never inserts silence.
 * - Assistant audio is placed by its provider `startMs`.
 * - Trusted provider stamps (output audio end, visitor transcript end) are lower
 *   bounds of the provider clock. If one is ahead of the visitor position by more
 *   than REANCHOR_TOLERANCE_MS, visitor audio was missed (for example during a
 *   sideband gap longer than the replay backlog) and placement jumps forward: the
 *   unobserved span stays silent and no visitor audio is invented.
 * - While the sideband is down and just after it returns, visitor audio is held;
 *   the provider's backlog flush is then placed to end at the newest trusted
 *   provider position (or contiguously when no provider timing arrived).
 * - Placement is monotonic: nothing is ever written before the visitor position or
 *   the emitted boundary, so already-written audio never moves backward.
 * - Frames are emitted once they fall `lagMs` behind the media head, never by
 *   wall-clock time.
 */
export class ProviderAnchoredTimeline {
  private readonly slots = new Map<number, Slot>();
  private inputPos = 0;
  private providerFloor = 0;
  private outputCursor = 0;
  private emitted = 0;
  private maxWritten = 0;
  private held: Int16Array[] | null = null;
  private heldSamples = 0;
  private floorAtHold = 0;
  private releaseAt: number | null = null;
  droppedSamples = 0;
  readonly stats: ProviderTimelineStats = {
    reanchors: 0,
    reanchoredMs: 0,
    anchoredReleases: 0,
    contiguousReleases: 0,
  };

  constructor(
    private readonly now: () => number = Date.now,
    private readonly lagMs: number = DEFAULT_LAG_MS,
    private readonly onPlaced?: TimelinePlacement,
  ) {}

  /** Emitted duration so far. */
  get emittedMs(): number {
    return (this.emitted * FRAME_SAMPLES) / SAMPLES_PER_MS;
  }

  /** Where the next visitor sample will be written (ms). */
  get inputPositionMs(): number {
    return this.inputPos / SAMPLES_PER_MS;
  }

  get holding(): boolean {
    return this.held !== null;
  }

  pushInput(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    this.maybeRelease();
    if (this.held) {
      this.held.push(pcm);
      this.heldSamples += pcm.length;
      if (this.heldSamples >= REATTACH_HOLD_MAX_MS * SAMPLES_PER_MS) this.release();
      return;
    }
    this.reanchor();
    this.placeInput(pcm);
  }

  pushOutput(pcm: Int16Array, startMs: number | null, endMs: number | null = null): void {
    if (pcm.length === 0) return;
    const head = this.head();
    let start =
      startMs !== null && Number.isFinite(startMs) && startMs >= 0
        ? Math.round(startMs * SAMPLES_PER_MS)
        : Math.max(this.outputCursor, this.inputPos - pcm.length);
    if (start > head + MAX_AHEAD_MS * SAMPLES_PER_MS) {
      this.droppedSamples += pcm.length;
      return;
    }
    if (startMs !== null && Number.isFinite(startMs) && startMs >= 0) {
      this.noteProviderTime(endMs !== null && Number.isFinite(endMs) ? endMs : startMs + pcm.length / SAMPLES_PER_MS);
    }
    // Late delta (its slot was already emitted): keep the speech, shift it forward.
    start = Math.max(start, this.emitted * FRAME_SAMPLES);
    this.write("right", start, pcm);
    this.onPlaced?.("output", pcm, start);
    this.outputCursor = start + pcm.length;
    this.maybeRelease();
  }

  /** A trusted provider-clock position (ms) that visitor media has reached. */
  noteProviderTime(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const pos = Math.round(ms * SAMPLES_PER_MS);
    const ahead = MAX_AHEAD_MS * SAMPLES_PER_MS;
    if (pos > Math.max(this.inputPos, this.providerFloor) + ahead) return;
    this.providerFloor = Math.max(this.providerFloor, pos);
  }

  /** The sideband dropped: hold visitor audio (the backlog flush arrives on re-attach). */
  controlDisconnected(): void {
    if (this.held) return;
    this.held = [];
    this.heldSamples = 0;
    this.floorAtHold = this.providerFloor;
    this.releaseAt = null;
  }

  /** The sideband is back: place held audio once the backlog flush has settled. */
  controlReattached(): void {
    if (!this.held) return;
    this.releaseAt = this.now() + REATTACH_SETTLE_MS;
  }

  /** Frames whose end is older than the lag window behind the media head. */
  drainReady(): StereoFrame[] {
    this.maybeRelease();
    const ready = Math.floor((this.head() - this.lagMs * SAMPLES_PER_MS) / FRAME_SAMPLES);
    return this.drainUntil(ready);
  }

  /** Final flush at session end: held audio is placed, then everything written is emitted. */
  drainAll(): StereoFrame[] {
    if (this.held) this.release();
    const end = Math.min(this.maxWritten, this.head());
    const frames = this.drainUntil(Math.ceil(end / FRAME_SAMPLES));
    this.slots.clear();
    return frames;
  }

  /** Media head: visitor position, or trusted provider timing when that is further. */
  private head(): number {
    return this.held ? this.inputPos : Math.max(this.inputPos, this.providerFloor);
  }

  private reanchor(): void {
    const behind = this.providerFloor - this.inputPos;
    if (behind > REANCHOR_TOLERANCE_MS * SAMPLES_PER_MS) {
      this.stats.reanchors += 1;
      this.stats.reanchoredMs += Math.round(behind / SAMPLES_PER_MS);
      this.inputPos = this.providerFloor;
    }
  }

  private maybeRelease(): void {
    if (this.held && this.releaseAt !== null && this.now() >= this.releaseAt) this.release();
  }

  private release(): void {
    const frames = this.held ?? [];
    const heldSamples = this.heldSamples;
    this.held = null;
    this.heldSamples = 0;
    this.releaseAt = null;
    const anchoredStart = this.providerFloor - heldSamples;
    if (this.providerFloor > this.floorAtHold && anchoredStart > this.inputPos) {
      this.stats.anchoredReleases += 1;
      this.stats.reanchors += 1;
      this.stats.reanchoredMs += Math.round((anchoredStart - this.inputPos) / SAMPLES_PER_MS);
      this.inputPos = anchoredStart;
    } else {
      this.stats.contiguousReleases += 1;
    }
    for (const pcm of frames) this.placeInput(pcm);
  }

  private placeInput(pcm: Int16Array): void {
    const start = Math.max(this.inputPos, this.emitted * FRAME_SAMPLES);
    this.write("left", start, pcm);
    this.onPlaced?.("input", pcm, start);
    this.inputPos = start + pcm.length;
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
