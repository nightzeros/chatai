import { describe, expect, it } from "vitest";

import { OnsetTracker } from "./onsets";
import { SOURCE_RATE } from "./timeline";

const SAMPLES_PER_MS = SOURCE_RATE / 1000;

function tone(ms: number, amplitude = 8000): Int16Array {
  const out = new Int16Array(ms * SAMPLES_PER_MS);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / SOURCE_RATE));
  return out;
}

const silence = (ms: number) => new Int16Array(ms * SAMPLES_PER_MS);
const at = (ms: number) => ms * SAMPLES_PER_MS;

describe("OnsetTracker", () => {
  it("reports speech runs with the quiet time before each", () => {
    const t = new OnsetTracker();
    t.feed(silence(500), 0);
    t.feed(tone(400), at(500));
    t.feed(silence(200), at(900));
    t.feed(tone(300), at(1_100)); // 200 ms pause: same run
    t.feed(silence(700), at(1_400));
    t.feed(tone(300), at(2_100)); // 700 ms pause: new run
    expect(t.runs.map(({ startMs, endMs, quietBeforeMs }) => ({ startMs, endMs, quietBeforeMs }))).toEqual([
      { startMs: 500, endMs: 1_400, quietBeforeMs: 800 },
      { startMs: 2_100, endMs: 2_400, quietBeforeMs: 700 },
    ]);
  });

  it("unobserved time between positioned chunks counts as quiet", () => {
    const t = new OnsetTracker();
    t.feed(silence(100), 0);
    t.feed(tone(200), at(100));
    t.feed(tone(200), at(1_300));
    expect(t.runs.map((r) => [r.startMs, r.quietBeforeMs])).toEqual([
      [100, 400],
      [1_300, 1_000],
    ]);
  });

  it("a noise floor seeded by loud first audio recovers at the first quiet window", () => {
    const t = new OnsetTracker();
    t.feed(tone(300), 0); // already speaking when tracking starts
    t.feed(silence(400), at(300));
    t.feed(tone(300), at(700));
    expect(t.runs.map((r) => r.startMs)).toEqual([700]);
  });

  it("steady low-level noise is not speech", () => {
    const t = new OnsetTracker();
    t.feed(tone(2_000, 150), 0);
    t.feed(tone(300), at(2_000));
    expect(t.runs.map((r) => r.startMs)).toEqual([2_000]);
  });

  it("keeps a bounded number of runs", () => {
    const t = new OnsetTracker(3);
    for (let i = 0; i < 6; i += 1) {
      t.feed(silence(400), at(i * 600));
      t.feed(tone(200), at(i * 600 + 400));
    }
    expect(t.runs.map((r) => r.startMs)).toEqual([2_200, 2_800, 3_400]);
  });
});
