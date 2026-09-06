import { describe, expect, it } from "vitest";

import {
  CANCELED_PLAN_CODE,
  isAllowedPolarProductId,
  isPaidPlanCode,
  parsePolarPlanProductMap,
  parsePolarProductAllowlist,
  planCodeForProductId,
  productIdForPlanCode,
} from "../plans";
import { shouldGrantPaidPlan, shouldRevertToFree } from "../status";

describe("Polar product allowlist", () => {
  const allowlist = parsePolarProductAllowlist({
    starterProductId: "prod_starter",
    proProductId: "prod_pro",
    businessProductId: " prod_business ",
  });

  it("maps configured product IDs to paid plans", () => {
    expect(planCodeForProductId("prod_starter", allowlist)).toBe("starter");
    expect(planCodeForProductId("prod_pro", allowlist)).toBe("pro");
    expect(planCodeForProductId("prod_business", allowlist)).toBe("business");
  });

  it("maps legacy TEAM product id to business", () => {
    const legacy = parsePolarProductAllowlist({
      teamProductId: "prod_team_legacy",
    });
    expect(planCodeForProductId("prod_team_legacy", legacy)).toBe("business");
  });

  it("rejects unknown products instead of defaulting to pro", () => {
    expect(planCodeForProductId("prod_cheap", allowlist)).toBeNull();
    expect(isAllowedPolarProductId("prod_cheap", allowlist)).toBe(false);
  });

  it("ignores empty product IDs", () => {
    expect(parsePolarProductAllowlist({ proProductId: " ", businessProductId: "" }).size).toBe(0);
  });
});

describe("planCode → product map (checkout)", () => {
  const map = parsePolarPlanProductMap({
    starterProductId: "prod_starter",
    proProductId: "prod_pro",
    businessProductId: "prod_business",
  });

  it("resolves product for paid plan codes", () => {
    expect(productIdForPlanCode("starter", map)).toBe("prod_starter");
    expect(productIdForPlanCode("pro", map)).toBe("prod_pro");
    expect(productIdForPlanCode("business", map)).toBe("prod_business");
  });

  it("validates paid plan codes", () => {
    expect(isPaidPlanCode("starter")).toBe(true);
    expect(isPaidPlanCode("free")).toBe(false);
    expect(isPaidPlanCode("team")).toBe(false);
  });
});

describe("CANCELED_PLAN_CODE", () => {
  it("is free", () => {
    expect(CANCELED_PLAN_CODE).toBe("free");
  });
});

describe("subscription status helpers", () => {
  it("grants paid plans for active and trialing", () => {
    expect(shouldGrantPaidPlan("active")).toBe(true);
    expect(shouldGrantPaidPlan("trialing")).toBe(true);
    expect(shouldGrantPaidPlan("past_due")).toBe(false);
  });

  it("reverts to free for terminal statuses", () => {
    expect(shouldRevertToFree("canceled")).toBe(true);
    expect(shouldRevertToFree("paused")).toBe(true);
    expect(shouldRevertToFree("past_due")).toBe(false);
    expect(shouldRevertToFree("active")).toBe(false);
  });
});
