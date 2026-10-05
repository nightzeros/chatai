import { describe, expect, it } from "vitest";

import { sanitizeAudioOffsetMs } from "./audio-offset";
import type { SpeechRun } from "./recording/onsets";
import {
  V2_TURN_TIMING,
  VoiceTurnOffsets,
  findAssistantOnsetMs,
  findVisitorOnsetMs,
  voiceTurnOffsetMs,
} from "./turn-offsets";

function run(startMs: number, endMs: number, quietBeforeMs = 5_000): SpeechRun {
  return { startMs, endMs, quietBeforeMs, leadMs: 0 };
}

function resolver(input: SpeechRun[] = [], output: SpeechRun[] = []) {
  return new VoiceTurnOffsets(() => ({ input, output }));
}

describe("V2 turn timing (locked Phase 9E decisions)", () => {
  it("uses the approved windows and fallbacks", () => {
    expect(V2_TURN_TIMING).toEqual({
      visitorSearchBeforeMs: 2_500,
      visitorSearchAfterMs: 200,
      visitorPauseBridgeMs: 600,
      visitorFallbackLagMs: 600,
      assistantSearchBeforeMs: 200,
      assistantSearchAfterMs: 1_500,
    });
  });
});

describe("visitor onset", () => {
  it("prefers the detected audio onset over the transcript stamp", () => {
    // Transcript lags speech by 580 ms (the measured median).
    expect(findVisitorOnsetMs([run(1_000, 2_400)], 1_580, 0)).toBe(1_000);
    const offsets = resolver([run(1_000, 2_400)]);
    expect(offsets.resolve("user", 1_580)).toBe(1_000);
    expect(offsets.stats).toMatchObject({ visitorOnset: 1, visitorFallback: 0 });
  });

  it("accepts an onset up to 200 ms after the stamp (transcript slightly early)", () => {
    expect(findVisitorOnsetMs([run(1_120, 2_000)], 1_000, 0)).toBe(1_120);
    expect(findVisitorOnsetMs([run(1_200, 2_000)], 1_000, 0)).toBe(1_200);
    expect(findVisitorOnsetMs([run(1_250, 2_000)], 1_000, 0)).toBeNull();
  });

  it("searches no further back than 2.5 s before the stamp", () => {
    expect(findVisitorOnsetMs([run(1_000, 5_000)], 3_500, 0)).toBe(1_000);
    expect(findVisitorOnsetMs([run(1_000, 5_000)], 3_600, 0)).toBeNull();
  });

  it("picks the speech stretch containing the fragment, not an earlier one", () => {
    const runs = [run(1_000, 1_500), run(3_000, 4_000, 1_500)];
    expect(findVisitorOnsetMs(runs, 3_500, 0)).toBe(3_000);
  });

  it("walks back across pauses shorter than 600 ms", () => {
    const runs = [run(1_000, 1_300), run(1_600, 1_800, 300), run(2_250, 2_600, 450)];
    expect(findVisitorOnsetMs(runs, 2_700, 0)).toBe(1_000);
  });

  it("does not bridge a pause of 600 ms or more", () => {
    const runs = [run(1_000, 1_200), run(1_800, 2_300, 600)];
    expect(findVisitorOnsetMs(runs, 2_000, 0)).toBe(1_800);
  });

  it("stops the walk-back at the search window", () => {
    const runs = [run(500, 900), run(1_000, 3_000, 100)];
    // lo = 3_200 − 2_500 = 700: the run at 500 is outside the window.
    expect(findVisitorOnsetMs(runs, 3_200, 0)).toBe(1_000);
  });

  it("never crosses the previous visitor turn boundary", () => {
    const runs = [run(1_000, 1_400), run(1_600, 2_400, 200)];
    expect(findVisitorOnsetMs(runs, 2_000, 1_500)).toBe(1_600);
    expect(findVisitorOnsetMs([run(1_000, 2_400)], 2_000, 1_500)).toBeNull();
  });

  it("never walks back across the start of an assistant reply (barge-in)", () => {
    const runs = [run(2_000, 2_800), run(3_200, 3_900, 400)];
    expect(findVisitorOnsetMs(runs, 3_700, 0)).toBe(2_000);
    expect(findVisitorOnsetMs(runs, 3_700, 0, [3_000])).toBe(3_200);
  });
});

describe("visitor fallback (transcript start − 600 ms)", () => {
  it("is used only when no onset qualifies", () => {
    const offsets = resolver([]);
    expect(offsets.resolve("user", 4_000)).toBe(3_400);
    expect(offsets.stats).toMatchObject({ visitorOnset: 0, visitorFallback: 1 });
  });

  it("is not applied on top of a detected onset", () => {
    expect(resolver([run(3_900, 4_500)]).resolve("user", 4_000)).toBe(3_900);
  });

  it("is clamped to zero", () => {
    expect(resolver([]).resolve("user", 300)).toBe(0);
  });

  it("is clamped to the previous visitor turn", () => {
    const input = [run(5_000, 5_200)];
    const offsets = resolver(input);
    expect(offsets.resolve("user", 5_100)).toBe(5_000);
    // Next turn has no detectable onset: 5_300 − 600 would precede turn one.
    input.length = 0;
    expect(offsets.resolve("user", 5_300)).toBe(5_000);
    expect(offsets.stats).toMatchObject({ visitorOnset: 1, visitorFallback: 1 });
  });

  it("is used when onset tracking is unavailable", () => {
    const offsets = new VoiceTurnOffsets(() => null);
    expect(offsets.resolve("user", 2_000)).toBe(1_400);
  });
});

describe("assistant onset and fallback", () => {
  it("prefers the first audible output audio", () => {
    // Assistant transcript leads its audio by 380 ms (the measured median).
    expect(findAssistantOnsetMs([run(1_380, 3_000)], 1_000, 0)).toBe(1_380);
    const offsets = resolver([], [run(1_380, 3_000)]);
    expect(offsets.resolve("assistant", 1_000)).toBe(1_380);
    expect(offsets.stats).toMatchObject({ assistantOnset: 1, assistantFallback: 0 });
  });

  it("searches from 200 ms before to 1500 ms after the stamp", () => {
    expect(findAssistantOnsetMs([run(800, 2_000)], 1_000, 0)).toBe(800);
    expect(findAssistantOnsetMs([run(790, 2_000)], 1_000, 0)).toBeNull();
    expect(findAssistantOnsetMs([run(2_500, 3_000)], 1_000, 0)).toBe(2_500);
    expect(findAssistantOnsetMs([run(2_510, 3_000)], 1_000, 0)).toBeNull();
  });

  it("returns no onset while earlier assistant speech is still in progress", () => {
    expect(findAssistantOnsetMs([run(500, 1_100), run(1_300, 2_000, 200)], 1_000, 0)).toBeNull();
  });

  it("falls back to the raw transcript stamp with no correction", () => {
    const offsets = resolver([], []);
    expect(offsets.resolve("assistant", 7_000)).toBe(7_000);
    expect(new VoiceTurnOffsets(() => null).resolve("assistant", 7_000)).toBe(7_000);
    expect(offsets.stats).toMatchObject({ assistantOnset: 0, assistantFallback: 1 });
  });
});

describe("VoiceTurnOffsets", () => {
  it("rejects malformed timing", () => {
    const offsets = resolver([run(1_000, 2_000)], [run(1_000, 2_000)]);
    for (const value of [null, undefined, "1200", Number.NaN, Number.POSITIVE_INFINITY, -5_000, 1e12, {}]) {
      expect(offsets.resolve("user", value)).toBeNull();
      expect(offsets.resolve("assistant", value)).toBeNull();
    }
    expect(offsets.stats).toEqual({ visitorOnset: 0, visitorFallback: 0, assistantOnset: 0, assistantFallback: 0 });
    // Rounding jitter just below zero is still the call start.
    expect(offsets.resolve("user", -3)).toBe(0);
  });

  it("resolves each turn once", () => {
    const input = [run(1_000, 2_000)];
    const offsets = resolver(input);
    expect(offsets.resolve("user", 1_500)).toBe(1_000);
    input.push(run(1_200, 1_300, 0));
    expect(offsets.resolve("user", 1_500)).toBe(1_000);
    expect(offsets.stats.visitorOnset).toBe(1);
  });

  it("keeps offsets monotonic per speaker in transcript order", () => {
    const input: SpeechRun[] = [];
    const offsets = resolver(input);
    // A later turn resolved first (fallback 4_400) bounds an earlier one from above.
    expect(offsets.resolve("user", 5_000)).toBe(4_400);
    input.push(run(4_850, 5_200));
    expect(offsets.resolve("user", 4_900)).toBe(4_400);
    // And from below: a turn after both never lands before them.
    input.length = 0;
    expect(offsets.resolve("user", 4_950)).toBe(4_400);
  });

  it("multi-turn call: every offset is in order and none is negative", () => {
    const input = [run(200, 1_400), run(6_000, 7_500, 4_600), run(12_100, 13_000, 4_600)];
    const output = [run(2_300, 5_000), run(8_400, 11_000, 3_400), run(13_800, 16_000, 2_800)];
    const offsets = resolver(input, output);
    const turns = [
      offsets.resolve("user", 780),
      offsets.resolve("assistant", 1_920),
      offsets.resolve("user", 6_580),
      offsets.resolve("assistant", 8_020),
      offsets.resolve("user", 12_680),
      offsets.resolve("assistant", 13_420),
    ];
    expect(turns).toEqual([200, 2_300, 6_000, 8_400, 12_100, 13_800]);
  });

  it("interruption: a visitor barge-in over assistant audio keeps its own onset", () => {
    const output = [run(1_000, 4_000)];
    const input = [run(200, 700), run(2_500, 3_300, 1_800)];
    const offsets = resolver(input, output);
    expect(offsets.resolve("user", 800)).toBe(200);
    expect(offsets.resolve("assistant", 700)).toBe(1_000);
    // Barge-in at 2.5 s, transcript at 3.1 s: overlap with the assistant turn is legitimate.
    expect(offsets.resolve("user", 3_100)).toBe(2_500);
    // The next reply after the interrupted one gets its own onset.
    output.push(run(5_300, 6_000, 1_300));
    expect(offsets.resolve("assistant", 5_000)).toBe(5_300);
  });

  it("short and long utterances", () => {
    // Short "yes": one 200 ms run, transcript 900 ms late.
    expect(resolver([run(3_000, 3_200)]).resolve("user", 3_900)).toBe(3_000);
    // Long answer with several short breaths: back to the first word.
    const long = [run(1_000, 2_900), run(3_300, 5_000, 400), run(5_450, 7_000, 450), run(7_500, 9_000, 500)];
    expect(resolver(long).resolve("user", 1_600)).toBe(1_000);
    expect(findVisitorOnsetMs(long, 7_600, 0)).toBe(5_450);
  });
});

describe("voiceTurnOffsetMs", () => {
  it("sessions without a V2 recording keep the raw transcript offset (V1)", () => {
    expect(voiceTurnOffsetMs({}, "user", 1_580)).toBe(1_580);
    expect(voiceTurnOffsetMs({ turnOffsets: null }, "assistant", 1_000)).toBe(1_000);
    expect(voiceTurnOffsetMs({}, "user", Number.NaN)).toBeNull();
  });

  it("uses the resolver on V2 sessions", () => {
    const session = { turnOffsets: resolver([run(1_000, 2_000)], [run(2_400, 3_000)]) };
    expect(voiceTurnOffsetMs(session, "user", 1_580)).toBe(1_000);
    expect(voiceTurnOffsetMs(session, "assistant", 2_000)).toBe(2_400);
  });

  it("never throws: a failing resolver falls back to the raw offset", () => {
    const broken = new VoiceTurnOffsets(() => {
      throw new Error("boom");
    });
    expect(voiceTurnOffsetMs({ turnOffsets: broken }, "user", 1_580)).toBe(sanitizeAudioOffsetMs(1_580));
    expect(voiceTurnOffsetMs({ turnOffsets: broken }, "user", "x")).toBeNull();
  });
});
