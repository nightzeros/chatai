import { describe, expect, it } from "vitest";

import {
  CANCELED_PLAN_CODE,
  isAllowedPolarProductId,
  parsePolarProductAllowlist,
  planCodeForProductId,
} from "../plans";
import { shouldGrantPaidPlan, shouldRevertToFree } from "../status";

describe("Polar product allowlist", () => {
  const allowlist = parsePolarProductAllowlist({
    proProductId: "prod_pro",
    teamProductId: " prod_team ",
  });

  it("maps configured product IDs to paid plans", () => {
    expect(planCodeForProductId("prod_pro", allowlist)).toBe("pro");
    expect(planCodeForProductId("prod_team", allowlist)).toBe("team");
  });

  it("rejects unknown products instead of defaulting to pro", () => {
    expect(planCodeForProductId("prod_cheap", allowlist)).toBeNull();
    expect(isAllowedPolarProductId("prod_cheap", allowlist)).toBe(false);
  });

  it("ignores empty product IDs", () => {
    expect(parsePolarProductAllowlist({ proProductId: " ", teamProductId: "" }).size).toBe(0);
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
