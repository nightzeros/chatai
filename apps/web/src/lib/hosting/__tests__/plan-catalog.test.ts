import { describe, expect, it } from "vitest";

import {
  ALL_PLAN_CODES,
  formatDisplayPrice,
  isHostingPlanCode,
  isPaidPlanCode,
  PLAN_CATALOG,
} from "../plan-catalog";

describe("plan catalog", () => {
  it("includes free starter pro business", () => {
    expect([...ALL_PLAN_CODES]).toEqual(["free", "starter", "pro", "business"]);
  });

  it("locks Free to $1 / 1 assistant / 75 requests", () => {
    expect(PLAN_CATALOG.free.hostedAiAllowanceUsd).toBe(1);
    expect(PLAN_CATALOG.free.maxAssistants).toBe(1);
    expect(PLAN_CATALOG.free.monthlyRequestCap).toBe(75);
    expect(PLAN_CATALOG.free.evalsEnabled).toBe(false);
  });

  it("distinguishes paid plan codes", () => {
    expect(isPaidPlanCode("starter")).toBe(true);
    expect(isPaidPlanCode("free")).toBe(false);
    expect(isHostingPlanCode("business")).toBe(true);
    expect(isHostingPlanCode("team")).toBe(false);
  });

  it("formats display prices", () => {
    expect(formatDisplayPrice(0)).toBe("$0");
    expect(formatDisplayPrice(1900)).toBe("$19");
  });
});
