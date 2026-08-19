import { describe, expect, it } from "vitest";

import { evaluateRateLimit, minuteWindowStart, secondsUntilWindowEnd } from "./rate-limit-window";

describe("minuteWindowStart", () => {
  it("truncates to the UTC minute", () => {
    const now = new Date("2026-08-18T14:32:47.891Z");
    expect(minuteWindowStart(now).toISOString()).toBe("2026-08-18T14:32:00.000Z");
  });
});

describe("secondsUntilWindowEnd", () => {
  it("returns remaining seconds in the window", () => {
    const windowStart = new Date("2026-08-18T14:32:00.000Z");
    const now = new Date("2026-08-18T14:32:30.000Z");
    expect(secondsUntilWindowEnd(windowStart, now)).toBe(30);
  });
});

describe("evaluateRateLimit", () => {
  const windowStart = new Date("2026-08-18T14:32:00.000Z");
  const now = new Date("2026-08-18T14:32:10.000Z");

  it("allows requests up to the limit", () => {
    expect(evaluateRateLimit(60, 60, windowStart, now)).toEqual({ ok: true });
  });

  it("rejects requests over the limit with Retry-After", () => {
    expect(evaluateRateLimit(61, 60, windowStart, now)).toEqual({ ok: false, retryAfter: 50 });
  });
});
