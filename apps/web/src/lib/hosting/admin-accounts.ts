import {
  eq,
  hostingAccounts,
  HOSTING_PLAN_CODES,
  sql,
  usagePeriodBalances,
  type HostingAccountStatus,
  type HostingPlanCode,
} from "@chatai/database";

import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";

import {
  getHostingAccountById,
  type HostingAccount,
} from "./accounts";
import { nextLimitOverrideAfterCredit } from "./admin-credit";
import { resolveEffectiveLimitMicros } from "./entitlements";
import { getOrCreateUsagePeriodBalance } from "./period-balance";

export type AdminAccountListRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: HostingAccountStatus;
  planCode: string;
  limitOverrideMicros: number | null;
  periodConsumedMicros: number;
  periodReservedMicros: number;
  periodLimitMicros: number | null;
  periodRequestCount: number;
  createdAt: string;
  updatedAt: string;
};

export async function listAdminHostingAccounts(opts?: {
  limit?: number;
  offset?: number;
}): Promise<AdminAccountListRow[]> {
  const limit = Math.min(200, Math.max(1, Math.floor(opts?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts?.offset ?? 0));

  const rows = await db().execute<{
    id: string;
    user_id: string;
    user_email: string | null;
    user_name: string | null;
    status: HostingAccountStatus;
    plan_code: string;
    limit_override_micros: number | null;
    period_consumed_micros: number | null;
    period_reserved_micros: number | null;
    period_limit_micros: number | null;
    period_request_count: number | null;
    created_at: Date | string;
    updated_at: Date | string;
  }>(sql`
    SELECT
      ha.id,
      ha.user_id,
      u.email AS user_email,
      u.name AS user_name,
      ha.status,
      ha.plan_code,
      ha.limit_override_micros,
      coalesce(upb.consumed_micros, 0) AS period_consumed_micros,
      coalesce(upb.reserved_micros, 0) AS period_reserved_micros,
      upb.limit_micros AS period_limit_micros,
      coalesce(upb.request_count, 0) AS period_request_count,
      ha.created_at,
      ha.updated_at
    FROM hosting_accounts AS ha
    LEFT JOIN "user" AS u ON u.id = ha.user_id
    LEFT JOIN LATERAL (
      SELECT
        b.consumed_micros,
        b.reserved_micros,
        b.limit_micros,
        b.request_count
      FROM usage_period_balances AS b
      WHERE b.account_id = ha.id
        AND b.period_start <= now()
        AND b.period_end > now()
      ORDER BY b.period_start DESC
      LIMIT 1
    ) AS upb ON true
    ORDER BY coalesce(upb.consumed_micros, 0) DESC, ha.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: row.user_name,
    status: row.status,
    planCode: row.plan_code,
    limitOverrideMicros:
      row.limit_override_micros == null ? null : Number(row.limit_override_micros),
    periodConsumedMicros: Number(row.period_consumed_micros) || 0,
    periodReservedMicros: Number(row.period_reserved_micros) || 0,
    periodLimitMicros:
      row.period_limit_micros == null ? null : Number(row.period_limit_micros),
    periodRequestCount: Number(row.period_request_count) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

async function syncCurrentPeriodLimit(
  account: HostingAccount,
  limitMicros: number,
): Promise<void> {
  const balance = await getOrCreateUsagePeriodBalance(account);
  await db()
    .update(usagePeriodBalances)
    .set({
      limitMicros,
      updatedAt: new Date(),
    })
    .where(eq(usagePeriodBalances.id, balance.id));
}

export type PatchHostingAccountInput = {
  status?: HostingAccountStatus;
  limitOverrideMicros?: number | null;
  planCode?: HostingPlanCode;
};

export async function patchHostingAccountAsAdmin(input: {
  accountId: string;
  actorUserId: string;
  patch: PatchHostingAccountInput;
}): Promise<HostingAccount | null> {
  const existing = await getHostingAccountById(input.accountId);
  if (!existing) return null;

  const updates: Partial<HostingAccount> = { updatedAt: new Date() };
  let limitChanged = false;
  let statusChanged = false;
  let planChanged = false;

  if (input.patch.status !== undefined && input.patch.status !== existing.status) {
    updates.status = input.patch.status;
    statusChanged = true;
  }

  if (
    input.patch.planCode !== undefined &&
    input.patch.planCode !== existing.planCode &&
    (HOSTING_PLAN_CODES as readonly string[]).includes(input.patch.planCode)
  ) {
    updates.planCode = input.patch.planCode;
    planChanged = true;
    limitChanged = true; // refresh period limit from new plan when no override
  }

  if (
    input.patch.limitOverrideMicros !== undefined &&
    input.patch.limitOverrideMicros !== existing.limitOverrideMicros
  ) {
    updates.limitOverrideMicros = input.patch.limitOverrideMicros;
    limitChanged = true;
  }

  if (!statusChanged && !limitChanged && !planChanged) {
    return existing;
  }

  const [updated] = await db()
    .update(hostingAccounts)
    .set(updates)
    .where(eq(hostingAccounts.id, input.accountId))
    .returning();

  if (!updated) return null;

  if (limitChanged || planChanged) {
    const effective = await resolveEffectiveLimitMicros(updated);
    await syncCurrentPeriodLimit(updated, effective);
    await logAuditEvent({
      userId: input.actorUserId,
      action: "usage_limit_updated",
      resourceType: "hosting_account",
      resourceId: updated.id,
      metadata: {
        previousOverrideMicros: existing.limitOverrideMicros,
        limitOverrideMicros: updated.limitOverrideMicros,
        previousPlanCode: existing.planCode,
        planCode: updated.planCode,
        effectiveLimitMicros: effective,
        targetUserId: updated.userId,
        via: "admin",
        planChanged,
      },
    });
  }

  if (statusChanged) {
    const action =
      updated.status === "suspended" ? "account_suspended" : "account_status_updated";
    await logAuditEvent({
      userId: input.actorUserId,
      action,
      resourceType: "hosting_account",
      resourceId: updated.id,
      metadata: {
        previousStatus: existing.status,
        status: updated.status,
        targetUserId: updated.userId,
      },
    });
  }

  return updated;
}

export async function creditHostingAccountAsAdmin(input: {
  accountId: string;
  actorUserId: string;
  creditMicros: number;
}): Promise<HostingAccount | null> {
  const credit = Math.max(0, Math.floor(input.creditMicros));
  if (credit <= 0) {
    throw new Error("creditMicros must be a positive integer.");
  }

  const existing = await getHostingAccountById(input.accountId);
  if (!existing) return null;

  const effectiveBefore = await resolveEffectiveLimitMicros(existing);
  const nextOverride = nextLimitOverrideAfterCredit({
    currentOverrideMicros: existing.limitOverrideMicros,
    effectiveLimitMicros: effectiveBefore,
    creditMicros: credit,
  });

  const [updated] = await db()
    .update(hostingAccounts)
    .set({
      limitOverrideMicros: nextOverride,
      updatedAt: new Date(),
    })
    .where(eq(hostingAccounts.id, input.accountId))
    .returning();

  if (!updated) return null;

  await syncCurrentPeriodLimit(updated, nextOverride);

  await logAuditEvent({
    userId: input.actorUserId,
    action: "usage_credit_applied",
    resourceType: "hosting_account",
    resourceId: updated.id,
    metadata: {
      creditMicros: credit,
      previousOverrideMicros: existing.limitOverrideMicros,
      limitOverrideMicros: nextOverride,
      previousEffectiveLimitMicros: effectiveBefore,
      targetUserId: updated.userId,
    },
  });

  return updated;
}

export function serializeHostingAccount(account: HostingAccount) {
  return {
    id: account.id,
    userId: account.userId,
    status: account.status,
    planCode: account.planCode,
    periodAnchor: account.periodAnchor.toISOString(),
    limitOverrideMicros: account.limitOverrideMicros,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
