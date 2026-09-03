/**
 * §8 Credit semantics audit.
 *
 * FINDING: `creditHostingAccountAsAdmin` bumps `limitOverrideMicros` permanently.
 * This means a one-time credit persists into ALL future periods.
 *
 * Current behavior: credit → limitOverrideMicros += creditMicros → syncs to current period.
 * Problem: limitOverrideMicros is the persistent account-level override. Next period
 * will create a new balance row with the elevated override, so the "one-time" credit
 * is actually permanent.
 *
 * This test documents the current behavior and flags it as a known issue.
 * The fix belongs to the Stripe/billing phase (separate current-period credit from
 * persistent limit override).
 */
import { describe, expect, it } from "vitest";

import { nextLimitOverrideAfterCredit } from "./admin-credit";

describe("§8 Credit semantics", () => {
  it("credit when no override → sets override to plan limit + credit", () => {
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: null,
      effectiveLimitMicros: 5_000_000,
      creditMicros: 1_000_000,
    });
    expect(result).toBe(6_000_000);
  });

  it("credit with existing override → adds to override", () => {
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: 7_000_000,
      effectiveLimitMicros: 5_000_000,
      creditMicros: 2_000_000,
    });
    expect(result).toBe(9_000_000);
  });

  it("multiple credits accumulate correctly", () => {
    let override: number | null = null;
    const effective = 5_000_000;

    override = nextLimitOverrideAfterCredit({
      currentOverrideMicros: override,
      effectiveLimitMicros: effective,
      creditMicros: 1_000_000,
    });
    expect(override).toBe(6_000_000);

    override = nextLimitOverrideAfterCredit({
      currentOverrideMicros: override,
      effectiveLimitMicros: effective,
      creditMicros: 500_000,
    });
    expect(override).toBe(6_500_000);
  });

  it("zero credit treated as zero (floor)", () => {
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: 5_000_000,
      effectiveLimitMicros: 5_000_000,
      creditMicros: 0,
    });
    expect(result).toBe(5_000_000);
  });

  it("negative credit treated as zero (floor, not debit)", () => {
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: 5_000_000,
      effectiveLimitMicros: 5_000_000,
      creditMicros: -1000,
    });
    expect(result).toBe(5_000_000);
  });

  it("fractional credit is floored to integer", () => {
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: 5_000_000,
      effectiveLimitMicros: 5_000_000,
      creditMicros: 999.9,
    });
    expect(result).toBe(5_000_999);
  });

  it("KNOWN ISSUE: credit persists into future periods via limitOverrideMicros", () => {
    // This documents the current behavior:
    // A credit of 1M bumps limitOverrideMicros from null→6M.
    // When a new period starts, getOrCreateUsagePeriodBalance calls
    // resolveEffectiveLimitMicros(account) which returns 6M (the override).
    // So the "one-time" credit is actually permanent.
    //
    // FIX DEFERRED TO STRIPE PHASE:
    // Separate `limitOverrideMicros` (persistent admin config) from
    // `periodCreditMicros` (one-time current-period boost).
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: null,
      effectiveLimitMicros: 5_000_000,
      creditMicros: 1_000_000,
    });
    // This IS the persistent override — it will carry forward
    expect(result).toBe(6_000_000);
  });

  it("Number.MAX_SAFE_INTEGER credit does not overflow with reasonable base", () => {
    // With very large credits, we should still get a valid number
    const result = nextLimitOverrideAfterCredit({
      currentOverrideMicros: 0,
      effectiveLimitMicros: 0,
      creditMicros: Number.MAX_SAFE_INTEGER,
    });
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(Number.MAX_SAFE_INTEGER);
  });
});
