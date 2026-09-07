import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lt,
  sql,
  usageEvents,
  type UsageBillingMode,
  type UsageEventStatus,
  type UsageOperation,
} from "@chatai/database";

import { db } from "@/lib/db";

import type { HostingAccount } from "./accounts";
import {
  getOrCreateUsagePeriodBalance,
  remainingMicros,
  usagePercent,
} from "./period-balance";
import {
  getPlanEntitlement,
  resolveEffectiveLimitMicros,
  resolvePlanRequestCap,
} from "./entitlements";

/** Ledger rows that represent actual provider calls (not reservation parents). */
const ACTUAL_EVENT_STATUSES: UsageEventStatus[] = ["shadow", "completed"];

export type UsageSummary = {
  accountId: string;
  planCode: string;
  status: HostingAccount["status"];
  periodStart: string;
  periodEnd: string;
  limitMicros: number;
  consumedMicros: number;
  reservedMicros: number;
  remainingMicros: number;
  usagePercent: number;
  requestCount: number;
  monthlyRequestCap: number | null;
};

export type UsageByAssistantRow = {
  assistantId: string | null;
  assistantName: string | null;
  assistantPublicId: string | null;
  eventCount: number;
  costMicros: number;
  byokCostMicros: number;
};

export type UsageByModelRow = {
  provider: string;
  model: string | null;
  operation: UsageOperation;
  billingMode: UsageBillingMode;
  eventCount: number;
  costMicros: number;
};

export type UsageRecentEvent = {
  id: string;
  requestId: string;
  assistantId: string | null;
  operation: UsageOperation;
  provider: string;
  model: string | null;
  billingMode: UsageBillingMode;
  status: UsageEventStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  finalCostMicros: number;
  createdAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown>;
};

export type UsageLimits = {
  accountId: string;
  status: HostingAccount["status"];
  planCode: string;
  planLimitMicros: number | null;
  limitOverrideMicros: number | null;
  effectiveLimitMicros: number;
  monthlyRequestCap: number | null;
  periodAnchor: string;
};

export async function getUsageSummary(
  account: HostingAccount,
  now = new Date(),
): Promise<UsageSummary> {
  const balance = await getOrCreateUsagePeriodBalance(account, now);
  const monthlyRequestCap = await resolvePlanRequestCap(account);

  return {
    accountId: account.id,
    planCode: account.planCode,
    status: account.status,
    periodStart: balance.periodStart.toISOString(),
    periodEnd: balance.periodEnd.toISOString(),
    limitMicros: balance.limitMicros,
    consumedMicros: balance.consumedMicros,
    reservedMicros: balance.reservedMicros,
    remainingMicros: remainingMicros(balance),
    usagePercent: Math.round(usagePercent(balance) * 10) / 10,
    requestCount: balance.requestCount,
    monthlyRequestCap,
  };
}

export async function getUsageLimits(account: HostingAccount): Promise<UsageLimits> {
  const plan = await getPlanEntitlement(account.planCode);
  const effectiveLimitMicros = await resolveEffectiveLimitMicros(account);
  const monthlyRequestCap = await resolvePlanRequestCap(account);

  return {
    accountId: account.id,
    status: account.status,
    planCode: account.planCode,
    planLimitMicros: plan?.monthlyLimitMicros ?? null,
    limitOverrideMicros: account.limitOverrideMicros,
    effectiveLimitMicros,
    monthlyRequestCap,
    periodAnchor: account.periodAnchor.toISOString(),
  };
}

/**
 * Cost by assistant for the current period.
 * Counts child/actual events only (`reserved_cost_micros = 0`) to avoid double-counting
 * reservation parent rows that also store the rollup final cost.
 */
export async function getUsageByAssistant(
  account: HostingAccount,
  now = new Date(),
): Promise<UsageByAssistantRow[]> {
  const balance = await getOrCreateUsagePeriodBalance(account, now);

  const rows = await db().execute<{
    assistant_id: string | null;
    assistant_name: string | null;
    assistant_public_id: string | null;
    event_count: number;
    cost_micros: number;
    byok_cost_micros: number;
  }>(sql`
    SELECT
      e.assistant_id AS assistant_id,
      a.name AS assistant_name,
      a.public_id AS assistant_public_id,
      cast(count(*) AS int) AS event_count,
      cast(coalesce(sum(e.final_cost_micros) FILTER (WHERE e.billing_mode = 'hosted'), 0) AS bigint) AS cost_micros,
      cast(coalesce(sum(
        CASE
          WHEN e.billing_mode = 'byok'
            THEN coalesce((e.metadata->>'byokProviderCostMicros')::bigint, 0)
          ELSE 0
        END
      ), 0) AS bigint) AS byok_cost_micros
    FROM usage_events AS e
    LEFT JOIN assistants AS a ON a.id = e.assistant_id
    WHERE e.account_id = ${account.id}
      AND e.created_at >= ${balance.periodStart.toISOString()}
      AND e.created_at < ${balance.periodEnd.toISOString()}
      AND e.reserved_cost_micros = 0
      AND e.status IN ('shadow', 'completed')
    GROUP BY e.assistant_id, a.name, a.public_id
    ORDER BY cost_micros DESC, event_count DESC
  `);

  return rows.map((row) => ({
    assistantId: row.assistant_id,
    assistantName: row.assistant_name,
    assistantPublicId: row.assistant_public_id,
    eventCount: Number(row.event_count) || 0,
    costMicros: Number(row.cost_micros) || 0,
    byokCostMicros: Number(row.byok_cost_micros) || 0,
  }));
}

export async function getUsageByModel(
  account: HostingAccount,
  now = new Date(),
): Promise<UsageByModelRow[]> {
  const balance = await getOrCreateUsagePeriodBalance(account, now);

  const rows = await db().execute<{
    provider: string;
    model: string | null;
    operation: UsageOperation;
    billing_mode: UsageBillingMode;
    event_count: number;
    cost_micros: number;
  }>(sql`
    SELECT
      e.provider,
      e.model,
      e.operation,
      e.billing_mode,
      cast(count(*) AS int) AS event_count,
      cast(coalesce(sum(e.final_cost_micros), 0) AS bigint) AS cost_micros
    FROM usage_events AS e
    WHERE e.account_id = ${account.id}
      AND e.created_at >= ${balance.periodStart.toISOString()}
      AND e.created_at < ${balance.periodEnd.toISOString()}
      AND e.reserved_cost_micros = 0
      AND e.status IN ('shadow', 'completed')
    GROUP BY e.provider, e.model, e.operation, e.billing_mode
    ORDER BY cost_micros DESC, event_count DESC
  `);

  return rows.map((row) => ({
    provider: row.provider,
    model: row.model,
    operation: row.operation,
    billingMode: row.billing_mode,
    eventCount: Number(row.event_count) || 0,
    costMicros: Number(row.cost_micros) || 0,
  }));
}

export async function getRecentUsageEvents(
  account: HostingAccount,
  opts?: { limit?: number; offset?: number; now?: Date },
): Promise<{ events: UsageRecentEvent[]; limit: number; offset: number }> {
  const limit = Math.min(100, Math.max(1, Math.floor(opts?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
  const now = opts?.now ?? new Date();
  const balance = await getOrCreateUsagePeriodBalance(account, now);

  const rows = await db()
    .select({
      id: usageEvents.id,
      requestId: usageEvents.requestId,
      assistantId: usageEvents.assistantId,
      operation: usageEvents.operation,
      provider: usageEvents.provider,
      model: usageEvents.model,
      billingMode: usageEvents.billingMode,
      status: usageEvents.status,
      inputTokens: usageEvents.inputTokens,
      outputTokens: usageEvents.outputTokens,
      totalTokens: usageEvents.totalTokens,
      finalCostMicros: usageEvents.finalCostMicros,
      createdAt: usageEvents.createdAt,
      completedAt: usageEvents.completedAt,
      metadata: usageEvents.metadata,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.accountId, account.id),
        gte(usageEvents.createdAt, balance.periodStart),
        lt(usageEvents.createdAt, balance.periodEnd),
        inArray(usageEvents.status, [...ACTUAL_EVENT_STATUSES, "failed", "abandoned"]),
      ),
    )
    .orderBy(desc(usageEvents.createdAt))
    .limit(limit)
    .offset(offset);

  return {
    limit,
    offset,
    events: rows.map((row) => ({
      id: row.id,
      requestId: row.requestId,
      assistantId: row.assistantId,
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      billingMode: row.billingMode,
      status: row.status,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.totalTokens,
      finalCostMicros: row.finalCostMicros,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      metadata: row.metadata ?? {},
    })),
  };
}

/** Pure helpers for unit tests / response shaping. */
export function parseRecentLimitParam(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(1, Math.floor(n)));
}

export function parseRecentOffsetParam(raw: string | null): number {
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}
