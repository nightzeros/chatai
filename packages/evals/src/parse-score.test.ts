import { describe, expect, it } from "vitest";

import { parseJudgeVerdict } from "./parse-score";

describe("parseJudgeVerdict", () => {
  it("parses score and reason from judge JSON", () => {
    expect(parseJudgeVerdict('{"score":0.75,"reason":"Mostly supported."}')).toEqual({
      score: 0.75,
      reason: "Mostly supported.",
    });
  });

  it("falls back to numeric parsing without reason", () => {
    expect(parseJudgeVerdict("0.65")).toEqual({ score: 0.65 });
  });
});
