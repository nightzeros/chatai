import { describe, expect, it } from "vitest";

import {
  CANCELED_PLAN_CODE,
  isAllowedStripePriceId,
  parseStripePriceAllowlist,
  planCodeForPriceId,
  planCodeFromPriceMetadata,
} from "../plans";

describe("planCodeFromPriceMetadata", () => {
  it("returns pro for plan_code=pro", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "pro" })).toBe("pro");
  });

  it("returns team for plan_code=team", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "team" })).toBe("team");
  });

  it("returns free for plan_code=free", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "free" })).toBe("free");
  });

  it("returns null for unknown plan_code", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "enterprise" })).toBeNull();
  });

  it("returns null for null metadata", () => {
    expect(planCodeFromPriceMetadata(null)).toBeNull();
  });

  it("returns null for undefined metadata", () => {
    expect(planCodeFromPriceMetadata(undefined)).toBeNull();
  });

  it("returns null for empty metadata", () => {
    expect(planCodeFromPriceMetadata({})).toBeNull();
  });
});

describe("CANCELED_PLAN_CODE", () => {
  it("is free", () => {
    expect(CANCELED_PLAN_CODE).toBe("free");
  });
});

describe("Stripe price allowlist", () => {
  const allowlist = parseStripePriceAllowlist({
    proPriceId: "price_pro",
    teamPriceId: " price_team ",
  });

  it("maps configured price IDs to paid plans", () => {
    expect(planCodeForPriceId("price_pro", allowlist)).toBe("pro");
    expect(planCodeForPriceId("price_team", allowlist)).toBe("team");
  });

  it("rejects unknown prices instead of defaulting to pro", () => {
    expect(planCodeForPriceId("price_cheap", allowlist)).toBeNull();
    expect(planCodeForPriceId(null, allowlist)).toBeNull();
    expect(isAllowedStripePriceId("price_cheap", allowlist)).toBe(false);
  });

  it("ignores empty price IDs", () => {
    const empty = parseStripePriceAllowlist({ proPriceId: " ", teamPriceId: "" });
    expect(empty.size).toBe(0);
  });
});
