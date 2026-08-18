import { describe, expect, it } from "vitest";

import { normalizeRrfScore, reciprocalRankFusion, RRF_K } from "./rrf";

describe("reciprocalRankFusion", () => {
  it("promotes items that rank well in both lists", () => {
    const scores = reciprocalRankFusion([
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [{ id: "b" }, { id: "a" }, { id: "d" }],
    ]);

    expect(scores.get("a")).toBeCloseTo(1 / (RRF_K + 1) + 1 / (RRF_K + 2));
    expect(scores.get("b")).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
    expect((scores.get("b") ?? 0)).toBeGreaterThan(scores.get("c") ?? 0);
    expect((scores.get("b") ?? 0)).toBeGreaterThan(scores.get("d") ?? 0);
  });

  it("still surfaces keyword-only matches", () => {
    const scores = reciprocalRankFusion([[{ id: "vector" }], [{ id: "keyword" }]]);
    expect(scores.get("keyword")).toBeCloseTo(1 / (RRF_K + 1));
    expect(scores.has("vector")).toBe(true);
  });
});

describe("normalizeRrfScore", () => {
  it("maps the dual rank-1 score to 1", () => {
    const dualTop = 2 / (RRF_K + 1);
    expect(normalizeRrfScore(dualTop, 2)).toBe(1);
  });
});
