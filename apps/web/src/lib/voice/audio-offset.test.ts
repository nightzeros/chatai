import { describe, expect, it } from "vitest";

import {
  MAX_AUDIO_OFFSET_MS,
  PLAY_FROM_PREROLL_MS,
  PLAY_FROM_PREROLL_V2_MS,
  activeTurnId,
  playFromPositionMs,
  playFromPrerollMs,
  sanitizeAudioOffsetMs,
  turnSeek,
} from "./audio-offset";

describe("sanitizeAudioOffsetMs", () => {
  it("keeps valid offsets as whole milliseconds", () => {
    expect(sanitizeAudioOffsetMs(0)).toBe(0);
    expect(sanitizeAudioOffsetMs(1_250)).toBe(1_250);
    expect(sanitizeAudioOffsetMs(1_250.6)).toBe(1_251);
    expect(sanitizeAudioOffsetMs(MAX_AUDIO_OFFSET_MS)).toBe(MAX_AUDIO_OFFSET_MS);
  });

  it("clamps rounding jitter just below zero to the call start", () => {
    expect(sanitizeAudioOffsetMs(-3)).toBe(0);
    expect(sanitizeAudioOffsetMs(-250)).toBe(0);
  });

  it("rejects missing or malformed values", () => {
    for (const value of [null, undefined, "1200", Number.NaN, Number.POSITIVE_INFINITY, -251, -5_000, MAX_AUDIO_OFFSET_MS + 1, {}]) {
      expect(sanitizeAudioOffsetMs(value)).toBeNull();
    }
  });
});

describe("turnSeek", () => {
  const ready = { playable: true, durationMs: 28_900 };

  it("seeks to a valid offset in a playable recording", () => {
    expect(turnSeek(4_000, ready)).toEqual({ available: true, ms: 4_000 });
  });

  it("partial recording: in-range offsets stay seekable, later ones are unavailable", () => {
    const partial = { playable: true, durationMs: 28_900 };
    expect(turnSeek(28_899, partial)).toEqual({ available: true, ms: 28_899 });
    expect(turnSeek(28_900, partial)).toEqual({ available: false, reason: "outside_recording" });
    expect(turnSeek(45_000, partial)).toEqual({ available: false, reason: "outside_recording" });
  });

  it("unknown recording length defers the range check to the player", () => {
    expect(turnSeek(90_000, { playable: true, durationMs: null })).toEqual({ available: true, ms: 90_000 });
  });

  it("legacy NULL and malformed offsets have no seek", () => {
    expect(turnSeek(null, ready)).toEqual({ available: false, reason: "no_offset" });
    expect(turnSeek(-9_000, ready)).toEqual({ available: false, reason: "no_offset" });
    expect(turnSeek(Number.NaN, ready)).toEqual({ available: false, reason: "no_offset" });
  });

  it("degrades when there is no recording or it cannot be played", () => {
    expect(turnSeek(1_000, null)).toEqual({ available: false, reason: "no_recording" });
    expect(turnSeek(1_000, { playable: false, durationMs: 28_900 })).toEqual({
      available: false,
      reason: "recording_unavailable",
    });
  });
});

describe("play-from preroll", () => {
  const recording = { playable: true, durationMs: 60_000 };

  function available(offsetMs: number, rec = recording) {
    const seek = turnSeek(offsetMs, rec);
    if (!seek.available) throw new Error(`expected a seek for ${offsetMs}`);
    return seek;
  }

  it("starts 0.5 s before a normal later turn; the offset itself is unchanged", () => {
    expect(PLAY_FROM_PREROLL_MS).toBe(500);
    const seek = available(12_000);
    expect(seek.ms).toBe(12_000);
    expect(playFromPositionMs(seek)).toBe(11_500);
  });

  it("never goes below zero for a turn near the start of the recording", () => {
    expect(playFromPositionMs(available(300))).toBe(0);
    expect(playFromPositionMs(available(500))).toBe(0);
    expect(playFromPositionMs(available(0))).toBe(0);
  });

  it("does not make an out-of-range turn in a partial recording playable", () => {
    const partial = { playable: true, durationMs: 28_900 };
    // 29.2 s minus the preroll would land inside the audio, but the turn itself is not there.
    expect(turnSeek(29_200, partial)).toEqual({ available: false, reason: "outside_recording" });
    expect(playFromPositionMs(available(28_000, partial))).toBe(27_500);
  });

  it("timeline V2 recordings start 120 ms before the turn; V1 keeps 500 ms", () => {
    expect(PLAY_FROM_PREROLL_V2_MS).toBe(120);
    expect(playFromPrerollMs(2)).toBe(120);
    expect(playFromPrerollMs(1)).toBe(500);
    const seek = available(12_000);
    expect(playFromPositionMs(seek, 2)).toBe(11_880);
    expect(playFromPositionMs(seek, 1)).toBe(11_500);
    expect(seek.ms).toBe(12_000);
  });

  it("unknown or missing timeline versions keep the V1 preroll", () => {
    for (const version of [null, undefined, 0, 3, Number.NaN]) {
      expect(playFromPrerollMs(version)).toBe(PLAY_FROM_PREROLL_MS);
      expect(playFromPositionMs(available(12_000), version)).toBe(11_500);
    }
  });

  it("V2 preroll never goes below zero", () => {
    expect(playFromPositionMs(available(80), 2)).toBe(0);
    expect(playFromPositionMs(available(120), 2)).toBe(0);
    expect(playFromPositionMs(available(300), 2)).toBe(180);
  });

  it("timeline boundaries stay at the real offsets", () => {
    const turns = [
      { id: "earlier", offsetMs: 4_000 },
      { id: "target", offsetMs: 12_000 },
    ];
    expect(activeTurnId(turns, playFromPositionMs(available(12_000)))).toBe("earlier");
    expect(activeTurnId(turns, 11_999)).toBe("earlier");
    expect(activeTurnId(turns, 12_000)).toBe("target");
  });
});

describe("activeTurnId", () => {
  const turns = [
    { id: "u1", offsetMs: 1_000 },
    { id: "a1", offsetMs: 2_600 },
    { id: "legacy", offsetMs: null },
    { id: "u2", offsetMs: 6_000 },
  ];

  it("highlights the last turn that started at or before the playhead", () => {
    expect(activeTurnId(turns, 500)).toBeNull();
    expect(activeTurnId(turns, 1_000)).toBe("u1");
    expect(activeTurnId(turns, 5_999)).toBe("a1");
    expect(activeTurnId(turns, 60_000)).toBe("u2");
  });

  it("ignores turns without offsets and invalid playheads", () => {
    expect(activeTurnId([{ id: "legacy", offsetMs: null }], 10_000)).toBeNull();
    expect(activeTurnId(turns, Number.NaN)).toBeNull();
  });
});
