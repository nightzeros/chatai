import { describe, expect, it } from "vitest";

import { FRAME_SAMPLES, SOURCE_RATE, type StereoFrame } from "./timeline";
import {
  REANCHOR_TOLERANCE_MS,
  REATTACH_HOLD_MAX_MS,
  REATTACH_SETTLE_MS,
  ProviderAnchoredTimeline,
} from "./timeline-v2";

const SAMPLES_PER_MS = SOURCE_RATE / 1000;
const PACKET_MS = 20;

function tone(ms: number, amplitude = 8000): Int16Array {
  const out = new Int16Array(ms * SAMPLES_PER_MS);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / SOURCE_RATE));
  return out;
}

const silence = (ms: number) => new Int16Array(ms * SAMPLES_PER_MS);

type Placement = { side: "input" | "output"; startMs: number; ms: number };

function harness(lagMs = 0) {
  let now = 0;
  const placed: Placement[] = [];
  const tl = new ProviderAnchoredTimeline(
    () => now,
    lagMs,
    (side, pcm, start) => placed.push({ side, startMs: start / SAMPLES_PER_MS, ms: pcm.length / SAMPLES_PER_MS }),
  );
  return {
    tl,
    placed,
    advance(ms: number) {
      now += ms;
    },
    /** A live microphone: one 20 ms packet per 20 ms of wall clock. */
    speak(ms: number, pcm: (ms: number) => Int16Array = tone) {
      for (let t = 0; t < ms; t += PACKET_MS) {
        now += PACKET_MS;
        tl.pushInput(pcm(PACKET_MS));
      }
    },
    /** A provider backlog flush: packets arrive back to back, no wall clock passes. */
    burst(ms: number) {
      for (let t = 0; t < ms; t += PACKET_MS) tl.pushInput(tone(PACKET_MS));
    },
    inputs() {
      return placed.filter((p) => p.side === "input");
    },
  };
}

const loud = (samples: Int16Array) => samples.some((s) => s !== 0);
const loudFrames = (frames: StereoFrame[], side: "left" | "right") =>
  frames.flatMap((frame, i) => (loud(frame[side]) ? [i] : []));

/** Visitor audio only ever moves forward and never overlaps itself. */
function expectMonotonicInput(placed: Placement[]) {
  let end = 0;
  for (const p of placed.filter((x) => x.side === "input")) {
    expect(p.startMs).toBeGreaterThanOrEqual(end);
    end = p.startMs + p.ms;
  }
}

describe("ProviderAnchoredTimeline (timeline V2)", () => {
  it("packet gap: visitor audio stays contiguous; wall-clock time never inserts silence", () => {
    const h = harness();
    h.tl.pushInput(tone(20));
    h.advance(1_000); // provider clock pauses while no RTP flows
    h.tl.pushInput(tone(20));
    expect(h.inputs().map((p) => p.startMs)).toEqual([0, 20]);
    const frames = h.tl.drainAll();
    expect(frames).toHaveLength(2);
    expect(loudFrames(frames, "left")).toEqual([0, 1]);
    expect(h.tl.stats).toEqual({ reanchors: 0, reanchoredMs: 0, anchoredReleases: 0, contiguousReleases: 0 });
  });

  it("muted microphone: silent packets advance the clock like speech (Phase 9C flow unchanged)", () => {
    const h = harness();
    h.speak(10_000, silence);
    h.tl.pushOutput(tone(200), 5_000, 5_200);
    h.speak(20);
    expect(h.tl.inputPositionMs).toBe(10_020);
    expect(h.inputs().at(-1)!.startMs).toBe(10_000);
    const frames = h.tl.drainAll();
    expect(frames).toHaveLength(501);
    expect(loudFrames(frames, "left")).toEqual([500]);
    expect(loudFrames(frames, "right")).toEqual(Array.from({ length: 10 }, (_, i) => 250 + i));
    expect(h.tl.stats.reanchors).toBe(0);
  });

  it("assistant audio is placed at its provider start", () => {
    const h = harness();
    h.speak(1_000, silence);
    h.tl.pushOutput(tone(200), 400, 600);
    const frames = h.tl.drainAll();
    expect(loudFrames(frames, "right")).toEqual(Array.from({ length: 10 }, (_, i) => 20 + i));
  });

  it("normal flow: provider timing at or near the visitor position never re-anchors", () => {
    const h = harness();
    h.speak(2_000);
    h.tl.pushOutput(tone(500), 1_400, 1_900); // output ends behind the visitor position (measured 0..−600 ms)
    h.tl.noteProviderTime(1_950); // visitor transcript end
    h.tl.noteProviderTime(2_000 + REANCHOR_TOLERANCE_MS); // within tolerance
    h.speak(20);
    expect(h.inputs().at(-1)!.startMs).toBe(2_000);
    expect(h.tl.stats.reanchors).toBe(0);
  });

  it("missed visitor audio: re-anchors to trusted provider timing and leaves the gap silent", () => {
    const h = harness();
    h.speak(1_000);
    h.tl.noteProviderTime(3_000); // provider says visitor media reached 3 s
    h.speak(20);
    expect(h.inputs().at(-1)!.startMs).toBe(3_000);
    expect(h.tl.stats).toMatchObject({ reanchors: 1, reanchoredMs: 2_000 });
    const frames = h.tl.drainAll();
    expect(frames).toHaveLength(151);
    // Nothing invented: 1–3 s is silence on the visitor side.
    expect(loudFrames(frames, "left")).toEqual([...Array.from({ length: 50 }, (_, i) => i), 150]);
    expectMonotonicInput(h.placed);
  });

  it("missed visitor audio: assistant output ahead of the visitor also re-anchors", () => {
    const h = harness();
    h.speak(1_000);
    h.tl.pushOutput(tone(200), 2_800, 3_000);
    h.speak(20);
    expect(h.inputs().at(-1)!.startMs).toBe(3_000);
    expect(h.tl.stats.reanchors).toBe(1);
  });

  it("sideband re-attach: the backlog flush is placed against the provider anchor", () => {
    const h = harness();
    h.speak(1_000);
    h.tl.controlDisconnected();
    expect(h.tl.holding).toBe(true);
    h.advance(5_000); // nothing arrives while detached
    h.tl.controlReattached();
    h.burst(3_000); // ~3 s backlog replayed on re-attach
    h.tl.pushOutput(tone(400), 5_600, 6_000);
    h.tl.noteProviderTime(5_900);
    expect(h.inputs()).toHaveLength(50); // held, not yet placed
    expect(h.tl.drainReady()).toHaveLength(50); // the head does not run ahead while holding

    h.advance(REATTACH_SETTLE_MS);
    h.speak(20);
    expect(h.tl.holding).toBe(false);
    const inputs = h.inputs();
    expect(inputs[50]!.startMs).toBe(3_000); // backlog ends at the provider position
    expect(inputs.at(-2)!.startMs).toBe(5_980);
    expect(inputs.at(-1)!.startMs).toBe(6_000); // live audio continues contiguously
    expect(h.tl.stats).toEqual({ reanchors: 1, reanchoredMs: 2_000, anchoredReleases: 1, contiguousReleases: 0 });
    expectMonotonicInput(h.placed);

    const frames = [...h.tl.drainAll()];
    expect(frames).toHaveLength(301 - 50);
    // 1–3 s was not observed: silent. Nothing is invented.
    expect(frames.slice(0, 100).every((f) => !loud(f.left))).toBe(true);
    expect(frames.slice(100).every((f) => loud(f.left))).toBe(true);
  });

  it("sideband re-attach without provider timing: held audio is placed contiguously", () => {
    const h = harness();
    h.speak(1_000);
    h.tl.controlDisconnected();
    h.advance(3_000);
    h.tl.controlReattached();
    h.burst(1_000);
    h.advance(REATTACH_SETTLE_MS);
    h.speak(20);
    const inputs = h.inputs();
    expect(inputs[50]!.startMs).toBe(1_000);
    expect(inputs.at(-1)!.startMs).toBe(2_000);
    expect(h.tl.stats).toEqual({ reanchors: 0, reanchoredMs: 0, anchoredReleases: 0, contiguousReleases: 1 });
    // A later provider stamp ahead of the visitor still re-anchors.
    h.tl.noteProviderTime(4_000);
    h.speak(20);
    expect(h.inputs().at(-1)!.startMs).toBe(4_000);
    expectMonotonicInput(h.placed);
  });

  it("an anchor behind the visitor position never moves audio backward", () => {
    const h = harness();
    h.speak(1_000);
    expect(h.tl.drainReady()).toHaveLength(50);
    h.tl.controlDisconnected();
    h.tl.controlReattached();
    h.burst(1_000);
    h.tl.noteProviderTime(1_500); // anchored start would be 500 ms: already written
    h.advance(REATTACH_SETTLE_MS);
    h.speak(20);
    expect(h.inputs()[50]!.startMs).toBe(1_000);
    expect(h.tl.stats).toMatchObject({ anchoredReleases: 0, contiguousReleases: 1 });
    expectMonotonicInput(h.placed);
  });

  it("held audio is placed once 8 s accumulate even if the sideband never returns", () => {
    const h = harness();
    h.speak(500);
    h.tl.controlDisconnected();
    h.speak(REATTACH_HOLD_MAX_MS - 20);
    expect(h.tl.holding).toBe(true);
    h.speak(20);
    expect(h.tl.holding).toBe(false);
    expect(h.inputs().at(-1)!.startMs).toBe(500 + REATTACH_HOLD_MAX_MS - 20);
    expect(h.tl.stats.contiguousReleases).toBe(1);
    expectMonotonicInput(h.placed);
  });

  it("late assistant audio whose slot was already emitted is shifted forward, never written backward", () => {
    const h = harness();
    h.speak(2_000);
    expect(h.tl.drainReady()).toHaveLength(100);
    h.tl.pushOutput(tone(100), 500, 600);
    const output = h.placed.filter((p) => p.side === "output");
    expect(output).toEqual([{ side: "output", startMs: 2_000, ms: 100 }]);
    h.speak(200, silence);
    const frames = h.tl.drainAll();
    expect(loudFrames(frames, "right")).toEqual([0, 1, 2, 3, 4]);
  });

  it("drops assistant audio implausibly far ahead (bounded memory)", () => {
    const h = harness();
    h.speak(100);
    h.tl.pushOutput(tone(100), 40_000, 40_100);
    expect(h.tl.droppedSamples).toBe(100 * SAMPLES_PER_MS);
    expect(h.tl.drainAll()).toHaveLength(5);
  });

  it("emits by media head minus the lag, never by wall clock", () => {
    const h = harness(1_500);
    h.speak(1_000);
    h.advance(60_000);
    expect(h.tl.drainReady()).toHaveLength(0);
    h.speak(1_000);
    expect(h.tl.drainReady()).toHaveLength(25);
    expect(h.tl.drainAll()).toHaveLength(75);
    expect(h.tl.emittedMs).toBe(2_000);
  });

  it("session end places held audio and emits everything written", () => {
    const h = harness(1_500);
    h.speak(500);
    h.tl.controlDisconnected();
    h.burst(500);
    const frames = h.tl.drainAll();
    expect(h.tl.holding).toBe(false);
    expect(frames).toHaveLength(50);
    expect(loudFrames(frames, "left")).toHaveLength(50);
  });

  it("bounded memory over a simulated 60-minute call with muted stretches", () => {
    let now = 0;
    const tl = new ProviderAnchoredTimeline(() => now, 1_500);
    const slots = (tl as unknown as { slots: Map<number, unknown> }).slots;
    const speech = tone(20);
    const muted = silence(20);
    let emitted = 0;
    let maxBuffered = 0;
    for (let f = 0; f < 60 * 60 * 50; f += 1) {
      now += 20;
      tl.pushInput(f % 1_000 < 500 ? speech : muted);
      if (f % 3 === 0) tl.pushOutput(speech, f * 20, f * 20 + 20);
      if (f % 10 === 0) emitted += tl.drainReady().length;
      maxBuffered = Math.max(maxBuffered, slots.size);
    }
    expect(maxBuffered).toBeLessThan(100);
    emitted += tl.drainAll().length;
    expect(emitted).toBe(60 * 60 * 50);
    expect(tl.stats.reanchors).toBe(0);
    expect(speech.length).toBe(FRAME_SAMPLES);
  });
});
