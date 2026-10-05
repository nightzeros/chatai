import { describe, expect, it } from "vitest";

import { AlignmentDiagnostics } from "./alignment-diagnostics";

const CHUNK = 4_800; // 200 ms at 24 kHz

function chunk(loudFromMs: number | null = null, softFromMs: number | null = null): Int16Array {
  const pcm = new Int16Array(CHUNK).fill(20);
  if (softFromMs !== null) {
    for (let i = Math.round(softFromMs * 24); i < CHUNK; i += 1) pcm[i] = i % 2 ? 150 : -150;
  }
  if (loudFromMs !== null) {
    for (let i = Math.round(loudFromMs * 24); i < CHUNK; i += 1) pcm[i] = i % 2 ? 4_000 : -4_000;
  }
  return pcm;
}

function clock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("AlignmentDiagnostics", () => {
  it("measures transcript bias against the reflected visitor onset", () => {
    const c = clock(10_000);
    const d = new AlignmentDiagnostics(9_000, c.now);
    for (let i = 0; i < 10; i += 1) {
      c.advance(200);
      d.onAudio({ source: "input", pcm: i === 5 ? chunk(50) : i > 5 ? chunk(0) : chunk() });
    }
    d.onTranscript("input", 1_600, 1_800);
    d.onTranscript("input", 1_800, 2_000);
    const s = d.summary();
    expect(s.firstInputAfterMintMs).toBe(1_200);
    expect(s.reflectedInputMs).toBe(2_000);
    expect(s.recorderGapInserts).toBe(0);
    expect(s.visitorTurns).toEqual([
      { transcriptStartMs: 1_600, audioOnsetMs: 1_050, biasMs: 550, onsetLeadMs: 0, bargeIn: false },
    ]);
    expect(s.reattaches).toEqual([]);
  });

  it("reports how long the energy was rising before the detected onset", () => {
    const c = clock(0);
    const d = new AlignmentDiagnostics(0, c.now);
    for (let i = 0; i < 4; i += 1) {
      c.advance(200);
      d.onAudio({ source: "input", pcm: i === 2 ? chunk(120, 60) : i > 2 ? chunk(0) : chunk() });
    }
    d.onTranscript("input", 900, 1_100);
    expect(d.summary().visitorTurns[0]).toMatchObject({ audioOnsetMs: 520, onsetLeadMs: 60 });
  });

  it("flags visitor turns that start while assistant audio is playing", () => {
    const c = clock(0);
    const d = new AlignmentDiagnostics(0, c.now);
    for (let i = 0; i < 12; i += 1) {
      c.advance(200);
      d.onAudio({ source: "input", pcm: i === 8 ? chunk(100) : i > 8 ? chunk(0) : chunk() });
    }
    d.onAudio({ source: "output", pcm: chunk(), startMs: 400, endMs: 600 });
    for (let i = 0; i < 6; i += 1) {
      d.onAudio({ source: "output", pcm: chunk(0), startMs: 600 + i * 200, endMs: 800 + i * 200 });
    }
    d.onTranscript("input", 200, 300);
    d.onTranscript("input", 2_100, 2_300);
    const turns = d.summary().visitorTurns;
    expect(turns.map((t) => t.bargeIn)).toEqual([false, true]);
    expect(turns[1]!.audioOnsetMs).toBe(1_700);
  });

  it("silent output frames streamed between answers do not count as the assistant speaking", () => {
    const c = clock(0);
    const d = new AlignmentDiagnostics(0, c.now);
    for (let i = 0; i < 12; i += 1) {
      c.advance(200);
      d.onAudio({ source: "input", pcm: i === 8 ? chunk(100) : i > 8 ? chunk(0) : chunk() });
      d.onAudio({ source: "output", pcm: i < 3 ? chunk(0) : chunk(), startMs: i * 200, endMs: (i + 1) * 200 });
    }
    d.onTranscript("input", 2_100, 2_300);
    expect(d.summary().visitorTurns).toMatchObject([{ audioOnsetMs: 1_700, bargeIn: false }]);
  });

  it("records sideband re-attach gaps, the backlog burst and the skew right after", () => {
    const c = clock(0);
    const d = new AlignmentDiagnostics(0, c.now);
    for (let i = 0; i < 5; i += 1) {
      c.advance(200);
      d.onAudio({ source: "input", pcm: chunk() });
    }
    d.onDisconnected();
    c.advance(4_000);
    // Provider flushes 3 s of backlog on attach, before and just after `control.reattached`.
    for (let i = 0; i < 10; i += 1) d.onAudio({ source: "input", pcm: chunk() });
    d.onReattached(4_000);
    for (let i = 0; i < 5; i += 1) d.onAudio({ source: "input", pcm: chunk() });
    c.advance(1_000);
    d.onAudio({ source: "input", pcm: chunk() });
    d.onAudio({ source: "output", pcm: chunk(), startMs: 3_800, endMs: 4_000 });
    const s = d.summary();
    expect(s.reattaches).toEqual([
      {
        gapMs: 4_000,
        atReflectedMs: 1_000,
        burstInputMs: 3_000,
        outputLeadAfterMs: -200,
        recorderSkewAfterMs: expect.any(Number),
      },
    ]);
    expect(s.reflectedInputMs).toBe(4_200);
  });

  it("reports recorder gap insertion and the skew it adds against the provider clock", () => {
    const c = clock(0);
    const d = new AlignmentDiagnostics(0, c.now);
    for (let i = 0; i < 5; i += 1) {
      c.advance(200);
      d.onAudio({ source: "input", pcm: chunk() });
    }
    c.advance(3_000); // media paused: provider timeline did not advance
    d.onAudio({ source: "input", pcm: chunk() });
    d.onAudio({ source: "output", pcm: chunk(), startMs: 1_000, endMs: 1_200 });
    const s = d.summary();
    expect(s.recorderGapInserts).toBe(1);
    expect(s.recorderGapInsertedMs).toBe(2_800);
    expect(s.outputLeadMs).toEqual({ min: 0, max: 0 });
    expect(s.recorderSkewMs).toEqual({ min: -2_800, max: -2_800 });
  });

  it("matches assistant transcript starts to output audio onsets on the provider timeline", () => {
    const c = clock(0);
    const d = new AlignmentDiagnostics(0, c.now);
    c.advance(200);
    d.onAudio({ source: "input", pcm: chunk() });
    for (let i = 0; i < 4; i += 1) {
      d.onAudio({ source: "output", pcm: i === 2 ? chunk(100) : i > 2 ? chunk(0) : chunk(), startMs: 3_000 + i * 200, endMs: 3_200 + i * 200 });
    }
    d.onTranscript("output", 3_200, 3_400);
    expect(d.summary().assistantTurns).toEqual([
      { transcriptStartMs: 3_200, audioOnsetMs: 3_500, biasMs: -300, onsetLeadMs: 0 },
    ]);
  });

  it("starts a new utterance only after a transcript gap", () => {
    const d = new AlignmentDiagnostics(0, () => 0);
    d.onTranscript("input", 0, 200);
    d.onTranscript("input", 400, 600);
    d.onTranscript("input", 2_000, 2_200);
    expect(d.summary().visitorTurns.map((t) => t.transcriptStartMs)).toEqual([0, 2_000]);
  });
});
