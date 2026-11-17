import { describe, expect, it } from "vitest";

import { bindCitationsToTurnEvidence } from "./citation-bind";

describe("bindCitationsToTurnEvidence", () => {
  it("accepts citations within this turn's passage count", () => {
    expect(bindCitationsToTurnEvidence("Built in React [1] and Node [2].", 2)).toEqual({ ok: true });
  });

  it("rejects out-of-range citations", () => {
    const result = bindCitationsToTurnEvidence("Claim [3].", 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.invalid).toEqual([3]);
  });

  it("rejects citations when no passages were supplied", () => {
    const result = bindCitationsToTurnEvidence("Claim [1].", 0);
    expect(result.ok).toBe(false);
  });
});
