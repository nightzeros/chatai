import { describe, expect, it } from "vitest";

import { nextLimitOverrideAfterCredit } from "./admin-credit";

describe("nextLimitOverrideAfterCredit", () => {
  it("adds credit on top of an existing override", () => {
    expect(
      nextLimitOverrideAfterCredit({
        currentOverrideMicros: 2_000_000,
        effectiveLimitMicros: 5_000_000,
        creditMicros: 1_000_000,
      }),
    ).toBe(3_000_000);
  });

  it("adds credit on top of the effective plan limit when no override", () => {
    expect(
      nextLimitOverrideAfterCredit({
        currentOverrideMicros: null,
        effectiveLimitMicros: 5_000_000,
        creditMicros: 500_000,
      }),
    ).toBe(5_500_000);
  });

  it("floors and treats negative credits as zero add", () => {
    expect(
      nextLimitOverrideAfterCredit({
        currentOverrideMicros: 1_000_000,
        effectiveLimitMicros: 5_000_000,
        creditMicros: -10,
      }),
    ).toBe(1_000_000);
  });
});
