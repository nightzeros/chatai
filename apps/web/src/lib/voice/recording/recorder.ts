import type { ReflectedAudioFrame } from "@chatai/voice";

import { PacketSpoolWriter, StereoOpusEncoder } from "./codec";
import { OnsetTracker } from "./onsets";
import { DEFAULT_LAG_MS, StereoTimeline } from "./timeline";
import { ProviderAnchoredTimeline, type ProviderTimelineStats } from "./timeline-v2";

const TICK_MS = 200;
/** Speech runs kept per side for turn offsets (a long call has a few thousand at most). */
const MAX_SPEECH_RUNS = 4_000;

/** 1 = visitor audio anchored on arrival (wall clock); 2 = provider media clock. */
export type RecordingTimelineVersion = 1 | 2;

export type RecorderStopResult =
  | { ok: true; packets: number; durationMs: number }
  | { ok: false; errorCode: string };

/** Speech onsets on the recording timeline (V2 only); numbers, never audio. */
export type RecordingOnsets = { input: OnsetTracker; output: OnsetTracker };

/**
 * Continuous server-side recorder for one Voice session. Reflected PCM lives
 * only in the timeline's 20 ms frames; every emitted frame is Opus-encoded
 * immediately and appended to a compressed packet spool on local disk.
 *
 * Best-effort: any failure disables the recorder (see `errorCode`) and never
 * throws into the Voice session.
 */
export class VoiceSessionRecorder {
  private readonly timeline: StereoTimeline | ProviderAnchoredTimeline;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  errorCode: string | null = null;
  readonly timelineVersion: RecordingTimelineVersion;
  /** Null on V1, or after onset tracking failed (offsets then use their fallbacks). */
  onsets: RecordingOnsets | null = null;

  private constructor(
    private readonly encoder: StereoOpusEncoder,
    private readonly spool: PacketSpoolWriter,
    readonly spoolPath: string,
    options: { now?: () => number; lagMs?: number; timelineVersion?: RecordingTimelineVersion },
  ) {
    this.timelineVersion = options.timelineVersion ?? 1;
    const lagMs = options.lagMs ?? DEFAULT_LAG_MS;
    if (this.timelineVersion === 2) {
      const onsets: RecordingOnsets = {
        input: new OnsetTracker(MAX_SPEECH_RUNS),
        output: new OnsetTracker(MAX_SPEECH_RUNS),
      };
      this.onsets = onsets;
      this.timeline = new ProviderAnchoredTimeline(options.now, lagMs, (side, pcm, start) => {
        if (!this.onsets) return;
        try {
          this.onsets[side].feed(pcm, start);
        } catch {
          this.onsets = null;
        }
      });
    } else {
      this.timeline = new StereoTimeline(options.now, lagMs);
    }
  }

  static async start(
    spoolPath: string,
    options: {
      now?: () => number;
      lagMs?: number;
      autoTick?: boolean;
      timelineVersion?: RecordingTimelineVersion;
    } = {},
  ): Promise<VoiceSessionRecorder> {
    const encoder = await StereoOpusEncoder.create();
    let spool: PacketSpoolWriter;
    try {
      spool = await PacketSpoolWriter.open(spoolPath);
    } catch (err) {
      encoder.free();
      throw err;
    }
    const recorder = new VoiceSessionRecorder(encoder, spool, spoolPath, options);
    if (options.autoTick !== false) {
      recorder.timer = setInterval(() => recorder.tick(), TICK_MS);
      recorder.timer.unref?.();
    }
    return recorder;
  }

  get preSkip(): number {
    return this.encoder.preSkip;
  }

  get active(): boolean {
    return !this.stopped && this.errorCode === null;
  }

  /** V2 placement counters for numbers-only diagnostics. */
  get timelineStats(): ProviderTimelineStats | null {
    return this.timeline instanceof ProviderAnchoredTimeline ? { ...this.timeline.stats } : null;
  }

  onAudio(frame: ReflectedAudioFrame): void {
    if (!this.active) return;
    try {
      if (frame.source === "input") this.timeline.pushInput(frame.pcm);
      else if (this.timeline instanceof ProviderAnchoredTimeline) {
        this.timeline.pushOutput(frame.pcm, frame.startMs, frame.endMs);
      } else this.timeline.pushOutput(frame.pcm, frame.startMs);
    } catch {
      this.fail("recording_timeline_error");
    }
  }

  /** Sideband transport changes (V2 re-anchoring; ignored on V1). */
  onControl(event: "disconnected" | "reattached"): void {
    if (!this.active || !(this.timeline instanceof ProviderAnchoredTimeline)) return;
    if (event === "disconnected") this.timeline.controlDisconnected();
    else this.timeline.controlReattached();
  }

  /** A trusted provider-clock position, e.g. a visitor transcript end (V2; ignored on V1). */
  noteProviderTime(ms: number): void {
    if (!this.active || !(this.timeline instanceof ProviderAnchoredTimeline)) return;
    this.timeline.noteProviderTime(ms);
  }

  /** Encode frames that left the lag window. Public for deterministic tests. */
  tick(): void {
    if (!this.active) return;
    this.encodeFrames(this.timeline.drainReady());
  }

  /** Flush, close the spool and release the encoder. Idempotent. */
  async stop(): Promise<RecorderStopResult> {
    if (!this.stopped) {
      if (this.errorCode === null) this.encodeFrames(this.timeline.drainAll());
      this.stopped = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.encoder.free();
      try {
        await this.spool.close();
      } catch {
        this.errorCode = this.errorCode ?? "recording_spool_write_failed";
      }
    }
    if (this.errorCode) return { ok: false, errorCode: this.errorCode };
    return { ok: true, packets: this.spool.packets, durationMs: this.timeline.emittedMs };
  }

  private encodeFrames(frames: ReturnType<StereoTimeline["drainReady"]>): void {
    if (frames.length === 0) return;
    if (this.spool.failure) {
      this.fail("recording_spool_write_failed");
      return;
    }
    try {
      this.spool.append(frames.map((frame) => this.encoder.encode(frame)));
    } catch {
      this.fail("recording_encode_failed");
    }
  }

  private fail(code: string): void {
    if (this.errorCode) return;
    this.errorCode = code;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
