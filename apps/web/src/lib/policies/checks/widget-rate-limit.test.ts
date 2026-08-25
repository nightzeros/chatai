import { describe, expect, it } from "vitest";

import { evaluateRateLimit, minuteWindowStart } from "../../rate-limit-window";

import {
  assistantRateScopeKey,
  consumeWidgetRateLimits,
  visitorRateScopeKey,
  type IncrementWidgetBucket,
} from "./widget-rate-limit";

function memoryIncrement(): {
  increment: IncrementWidgetBucket;
  counts: Map<string, number>;
} {
  const counts = new Map<string, number>();
  const increment: IncrementWidgetBucket = async ({ scope, scopeKey, windowStart }) => {
    const key = `${scope}:${scopeKey}:${windowStart.toISOString()}`;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  };
  return { increment, counts };
}

/** Non-atomic read → delay → write (race-prone). Used to contrast with atomic increment. */
function racyIncrement(): IncrementWidgetBucket {
  const counts = new Map<string, number>();
  return async ({ scope, scopeKey, windowStart }) => {
    const key = `${scope}:${scopeKey}:${windowStart.toISOString()}`;
    const current = counts.get(key) ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    const next = current + 1;
    counts.set(key, next);
    return next;
  };
}

describe("widget rate scope keys", () => {
  it("builds predictable visitor and assistant keys", () => {
    expect(visitorRateScopeKey("asst_1", "visitor-a")).toBe("asst_1:visitor-a");
    expect(assistantRateScopeKey("asst_1")).toBe("asst_1");
  });
});

describe("consumeWidgetRateLimits", () => {
  const now = new Date("2026-08-24T18:32:10.000Z");
  const windowStart = minuteWindowStart(now);

  it("allows requests below the visitor and assistant limits", async () => {
    const { increment } = memoryIncrement();
    for (let i = 0; i < 3; i++) {
      const result = await consumeWidgetRateLimits({
        assistantId: "asst_1",
        visitorId: "v1",
        perVisitorLimit: 5,
        perAssistantLimit: 10,
        now,
        increment,
      });
      expect(result).toBeNull();
    }
  });

  it("returns 429 with Retry-After when a visitor exceeds their limit", async () => {
    const { increment } = memoryIncrement();
    const opts = {
      assistantId: "asst_1",
      visitorId: "v1",
      perVisitorLimit: 2,
      perAssistantLimit: 100,
      now,
      increment,
    };

    expect(await consumeWidgetRateLimits(opts)).toBeNull();
    expect(await consumeWidgetRateLimits(opts)).toBeNull();

    const limited = await consumeWidgetRateLimits(opts);
    expect(limited).toMatchObject({
      status: 429,
      message: "Rate limit exceeded.",
      reason: "widget_rate_limit_visitor",
    });
    const expected = evaluateRateLimit(3, 2, windowStart, now);
    expect(expected.ok).toBe(false);
    if (expected.ok) {
      throw new Error("expected rate limit rejection");
    }
    expect(limited?.headers?.["Retry-After"]).toBe(String(expected.retryAfter));
    expect(Number(limited?.headers?.["Retry-After"])).toBeGreaterThan(0);
  });

  it("isolates visitors — one visitor hitting the limit does not block another", async () => {
    const { increment } = memoryIncrement();
    const base = {
      assistantId: "asst_1",
      perVisitorLimit: 1,
      perAssistantLimit: 100,
      now,
      increment,
    };

    expect(await consumeWidgetRateLimits({ ...base, visitorId: "a" })).toBeNull();
    expect((await consumeWidgetRateLimits({ ...base, visitorId: "a" }))?.reason).toBe(
      "widget_rate_limit_visitor",
    );
    expect(await consumeWidgetRateLimits({ ...base, visitorId: "b" })).toBeNull();
  });

  it("enforces the per-assistant limit across visitors", async () => {
    const { increment } = memoryIncrement();
    const base = {
      assistantId: "asst_1",
      perVisitorLimit: 100,
      perAssistantLimit: 3,
      now,
      increment,
    };

    expect(await consumeWidgetRateLimits({ ...base, visitorId: "a" })).toBeNull();
    expect(await consumeWidgetRateLimits({ ...base, visitorId: "b" })).toBeNull();
    expect(await consumeWidgetRateLimits({ ...base, visitorId: "c" })).toBeNull();

    const limited = await consumeWidgetRateLimits({ ...base, visitorId: "d" });
    expect(limited).toMatchObject({
      status: 429,
      reason: "widget_rate_limit_assistant",
      message: "Rate limit exceeded.",
    });
    expect(Number(limited?.headers?.["Retry-After"])).toBeGreaterThan(0);
  });

  it("applies assistant limit when visitorId is missing (e.g. config fetch)", async () => {
    const { increment, counts } = memoryIncrement();
    const result = await consumeWidgetRateLimits({
      assistantId: "asst_1",
      visitorId: null,
      perVisitorLimit: 1,
      perAssistantLimit: 2,
      now,
      increment,
    });
    expect(result).toBeNull();
    expect([...counts.keys()].some((k) => k.startsWith("visitor:"))).toBe(false);
    expect([...counts.keys()].some((k) => k.startsWith("assistant:"))).toBe(true);
  });

  it("allows traffic again after the minute window resets", async () => {
    const { increment } = memoryIncrement();
    const firstWindow = new Date("2026-08-24T18:32:50.000Z");
    const nextWindow = new Date("2026-08-24T18:33:01.000Z");

    const opts = {
      assistantId: "asst_1",
      visitorId: "v1",
      perVisitorLimit: 1,
      perAssistantLimit: 100,
      increment,
    };

    expect(await consumeWidgetRateLimits({ ...opts, now: firstWindow })).toBeNull();
    expect((await consumeWidgetRateLimits({ ...opts, now: firstWindow }))?.status).toBe(429);
    expect(await consumeWidgetRateLimits({ ...opts, now: nextWindow })).toBeNull();
  });

  it("uses env-style defaults without assistant overrides", async () => {
    const { increment } = memoryIncrement();
    // Defaults from Task 1: visitor 20, assistant 120 — 5 requests must pass.
    for (let i = 0; i < 5; i++) {
      expect(
        await consumeWidgetRateLimits({
          assistantId: "asst_1",
          visitorId: "v1",
          perVisitorLimit: 20,
          perAssistantLimit: 120,
          now,
          increment,
        }),
      ).toBeNull();
    }
  });

  it("atomic increments reject excess under concurrent load", async () => {
    const { increment } = memoryIncrement();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeWidgetRateLimits({
          assistantId: "asst_1",
          visitorId: "v1",
          perVisitorLimit: 10,
          perAssistantLimit: 100,
          now,
          increment,
        }),
      ),
    );

    const allowed = results.filter((r) => r === null).length;
    const limited = results.filter((r) => r?.status === 429).length;
    expect(allowed).toBe(10);
    expect(limited).toBe(10);
  });

  it("documents why non-atomic increments are unsafe under concurrency", async () => {
    const increment = racyIncrement();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeWidgetRateLimits({
          assistantId: "asst_race",
          visitorId: "v1",
          perVisitorLimit: 10,
          perAssistantLimit: 100,
          now,
          increment,
        }),
      ),
    );

    // With a racey counter, more than the limit may be allowed — production uses
    // INSERT … ON CONFLICT DO UPDATE RETURNING instead (see incrementWidgetRateBucket).
    const allowed = results.filter((r) => r === null).length;
    expect(allowed).toBeGreaterThan(10);
  });
});
