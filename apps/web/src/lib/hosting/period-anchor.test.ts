import { describe, expect, it } from "vitest";

import { currentBillingPeriod, defaultPeriodAnchor } from "./period-anchor";

describe("defaultPeriodAnchor", () => {
  it("returns UTC start of the month", () => {
    const anchor = defaultPeriodAnchor(new Date("2026-03-15T14:22:00.000Z"));
    expect(anchor.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("currentBillingPeriod", () => {
  it("returns the in-progress period for a mid-month reference date", () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const { periodStart, periodEnd } = currentBillingPeriod(
      anchor,
      new Date("2026-03-15T12:00:00.000Z"),
    );

    expect(periodStart.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("uses the previous month when the anchor day has not occurred yet", () => {
    const anchor = new Date("2026-01-15T00:00:00.000Z");
    const { periodStart, periodEnd } = currentBillingPeriod(
      anchor,
      new Date("2026-03-10T12:00:00.000Z"),
    );

    expect(periodStart.toISOString()).toBe("2026-02-15T00:00:00.000Z");
    expect(periodEnd.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });
});
