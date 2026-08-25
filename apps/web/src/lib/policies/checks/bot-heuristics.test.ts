import { afterEach, describe, expect, it } from "vitest";

import {
  clearBurstTracker,
  evaluateBotHeuristics,
  isSuspiciousUserAgent,
  isValidVisitorId,
  recordBurstAndAllow,
} from "./bot-heuristics";

describe("isValidVisitorId", () => {
  it("accepts 8–80 char alphanumeric ids with _ and -", () => {
    expect(isValidVisitorId("visitor1")).toBe(true);
    expect(isValidVisitorId("a".repeat(8))).toBe(true);
    expect(isValidVisitorId("a".repeat(80))).toBe(true);
    expect(isValidVisitorId("uuid-like_01")).toBe(true);
  });

  it("rejects missing, short, or invalid ids", () => {
    expect(isValidVisitorId(null)).toBe(false);
    expect(isValidVisitorId(undefined)).toBe(false);
    expect(isValidVisitorId("short")).toBe(false);
    expect(isValidVisitorId("bad id!!")).toBe(false);
    expect(isValidVisitorId("a".repeat(81))).toBe(false);
  });
});

describe("isSuspiciousUserAgent", () => {
  it("rejects missing, empty, and known bot agents", () => {
    expect(isSuspiciousUserAgent(null)).toBe(true);
    expect(isSuspiciousUserAgent("")).toBe(true);
    expect(isSuspiciousUserAgent("curl/8.0")).toBe(true);
    expect(isSuspiciousUserAgent("python-requests/2.31")).toBe(true);
    expect(isSuspiciousUserAgent("Wget/1.21")).toBe(true);
  });

  it("allows typical browser agents", () => {
    expect(
      isSuspiciousUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0",
      ),
    ).toBe(false);
  });
});

describe("recordBurstAndAllow", () => {
  afterEach(() => clearBurstTracker());

  it("allows up to 3 events in 2 seconds then rejects", () => {
    const now = new Date("2026-08-24T20:00:00.000Z");
    expect(recordBurstAndAllow("k", now)).toBe(true);
    expect(recordBurstAndAllow("k", new Date(now.getTime() + 100))).toBe(true);
    expect(recordBurstAndAllow("k", new Date(now.getTime() + 200))).toBe(true);
    expect(recordBurstAndAllow("k", new Date(now.getTime() + 300))).toBe(false);
  });

  it("resets after the window elapses", () => {
    const now = new Date("2026-08-24T20:00:00.000Z");
    expect(recordBurstAndAllow("k2", now)).toBe(true);
    expect(recordBurstAndAllow("k2", new Date(now.getTime() + 100))).toBe(true);
    expect(recordBurstAndAllow("k2", new Date(now.getTime() + 200))).toBe(true);
    expect(recordBurstAndAllow("k2", new Date(now.getTime() + 2_100))).toBe(true);
  });
});

describe("evaluateBotHeuristics", () => {
  afterEach(() => clearBurstTracker());

  const browserUa =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0";

  it("skips checks for config-style requests (no message, no visitorId)", () => {
    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        userAgent: "curl/8.0",
      }),
    ).toEqual({ ok: true });
  });

  it("requires a valid visitorId for chat sends", () => {
    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        message: "Hello",
        visitorId: null,
        userAgent: browserUa,
      }),
    ).toEqual({ ok: false, reason: "bot_invalid_visitor_id" });

    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        message: "Hello",
        visitorId: "short",
        userAgent: browserUa,
      }),
    ).toEqual({ ok: false, reason: "bot_invalid_visitor_id" });
  });

  it("rejects suspicious user agents on chat sends", () => {
    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        message: "Hello",
        visitorId: "visitor01",
        userAgent: "curl/8.5.0",
      }),
    ).toEqual({ ok: false, reason: "bot_suspicious_user_agent" });
  });

  it("rejects empty chat messages", () => {
    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        message: "   ",
        visitorId: "visitor01",
        userAgent: browserUa,
      }),
    ).toEqual({ ok: false, reason: "bot_empty_message" });
  });

  it("rejects chat bursts over 3 messages in 2 seconds", () => {
    const now = new Date("2026-08-24T20:00:00.000Z");
    const base = {
      assistantId: "asst_1",
      visitorId: "visitor01",
      userAgent: browserUa,
      message: "hi",
    };

    expect(evaluateBotHeuristics({ ...base, now })).toEqual({ ok: true });
    expect(evaluateBotHeuristics({ ...base, now: new Date(now.getTime() + 50) })).toEqual({
      ok: true,
    });
    expect(evaluateBotHeuristics({ ...base, now: new Date(now.getTime() + 100) })).toEqual({
      ok: true,
    });
    expect(evaluateBotHeuristics({ ...base, now: new Date(now.getTime() + 150) })).toEqual({
      ok: false,
      reason: "bot_burst",
    });
  });

  it("allows a normal browser chat send", () => {
    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        message: "What are your hours?",
        visitorId: "visitor01",
        userAgent: browserUa,
      }),
    ).toEqual({ ok: true });
  });

  it("validates visitorId on feedback-style requests that include one", () => {
    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        visitorId: "bad",
        userAgent: browserUa,
      }),
    ).toEqual({ ok: false, reason: "bot_invalid_visitor_id" });

    expect(
      evaluateBotHeuristics({
        assistantId: "asst_1",
        visitorId: "visitor01",
        userAgent: browserUa,
      }),
    ).toEqual({ ok: true });
  });
});
