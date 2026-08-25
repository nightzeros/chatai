import { sql, type WidgetRateScope } from "@chatai/database";

import { evaluateRateLimit, minuteWindowStart } from "../../rate-limit-window";
import type { PolicyViolation } from "../policy-violation";

export function visitorRateScopeKey(assistantId: string, visitorId: string): string {
  return `${assistantId}:${visitorId}`;
}

export function assistantRateScopeKey(assistantId: string): string {
  return assistantId;
}

export type IncrementWidgetBucket = (input: {
  scope: WidgetRateScope;
  scopeKey: string;
  windowStart: Date;
}) => Promise<number>;

/**
 * Atomic upsert: INSERT … ON CONFLICT DO UPDATE count = count + 1 RETURNING count.
 * Concurrent callers each get a unique monotonic count for the window.
 *
 * Loads `db` lazily so unit tests can inject a memory increment without resolving
 * Next.js `@/` path aliases used by `db.ts`.
 */
export async function incrementWidgetRateBucket(input: {
  scope: WidgetRateScope;
  scopeKey: string;
  windowStart: Date;
}): Promise<number> {
  const { db } = await import("../../db");
  const [row] = await db().execute<{ count: number }>(sql`
    INSERT INTO widget_rate_buckets (scope, scope_key, window_start, count)
    VALUES (${input.scope}, ${input.scopeKey}, ${input.windowStart.toISOString()}, 1)
    ON CONFLICT (scope, scope_key, window_start)
    DO UPDATE SET count = widget_rate_buckets.count + 1
    RETURNING count
  `);

  if (!row) {
    throw new Error("Widget rate limit increment failed.");
  }

  return Number(row.count);
}

export type ConsumeWidgetRateLimitsInput = {
  assistantId: string;
  visitorId?: string | null;
  perVisitorLimit: number;
  perAssistantLimit: number;
  now?: Date;
  /** Test seam — defaults to Postgres atomic upsert. */
  increment?: IncrementWidgetBucket;
};

/**
 * Consume visitor (when visitorId present) then assistant minute windows.
 * Returns a PolicyViolation on 429, or null when allowed.
 */
export async function consumeWidgetRateLimits(
  input: ConsumeWidgetRateLimitsInput,
): Promise<PolicyViolation | null> {
  const now = input.now ?? new Date();
  const windowStart = minuteWindowStart(now);
  const increment = input.increment ?? incrementWidgetRateBucket;

  if (input.visitorId) {
    const visitorCount = await increment({
      scope: "visitor",
      scopeKey: visitorRateScopeKey(input.assistantId, input.visitorId),
      windowStart,
    });
    const visitorResult = evaluateRateLimit(
      visitorCount,
      input.perVisitorLimit,
      windowStart,
      now,
    );
    if (!visitorResult.ok) {
      return {
        status: 429,
        message: "Rate limit exceeded.",
        headers: { "Retry-After": String(visitorResult.retryAfter) },
        reason: "widget_rate_limit_visitor",
      };
    }
  }

  const assistantCount = await increment({
    scope: "assistant",
    scopeKey: assistantRateScopeKey(input.assistantId),
    windowStart,
  });
  const assistantResult = evaluateRateLimit(
    assistantCount,
    input.perAssistantLimit,
    windowStart,
    now,
  );
  if (!assistantResult.ok) {
    return {
      status: 429,
      message: "Rate limit exceeded.",
      headers: { "Retry-After": String(assistantResult.retryAfter) },
      reason: "widget_rate_limit_assistant",
    };
  }

  return null;
}
