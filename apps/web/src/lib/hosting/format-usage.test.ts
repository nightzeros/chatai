import { describe, expect, it } from "vitest";

import {
  formatPlanCode,
  formatUsdFromMicros,
  usageBarTone,
} from "./format-usage";

describe("formatUsdFromMicros", () => {
  it("formats whole dollars", () => {
    expect(formatUsdFromMicros(5_000_000)).toBe("$5.00");
    expect(formatUsdFromMicros(0)).toBe("$0.00");
  });

  it("shows extra precision for tiny amounts", () => {
    expect(formatUsdFromMicros(450)).toMatch(/\$0\.00045/);
  });
});

describe("usageBarTone", () => {
  it("escalates near the limit", () => {
    expect(usageBarTone(10)).toBe("default");
    expect(usageBarTone(75)).toBe("warning");
    expect(usageBarTone(95)).toBe("danger");
  });
});

describe("formatPlanCode", () => {
  it("capitalizes plan labels", () => {
    expect(formatPlanCode("free")).toBe("Free");
  });
});
