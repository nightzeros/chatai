import {
  and,
  eq,
  usagePeriodBalances,
} from "@chatai/database";

import { db } from "@/lib/db";
import { createId } from "@/lib/ids";

import type { HostingAccount } from "./accounts";
import { resolveEffectiveLimitMicros } from "./entitlements";
import { currentBillingPeriod } from "./period-anchor";
import { resolveVoiceSecondsLimit } from "./plan-entitlements";

export type UsagePeriodBalance = typeof usagePeriodBalances.$inferSelect;

export async function getUsagePeriodBalance(
  accountId: string,
  periodStart: Date,
): Promise<UsagePeriodBalance | null> {
  const [row] = await db()
    .select()
    .from(usagePeriodBalances)
    .where(
      and(
        eq(usagePeriodBalances.accountId, accountId),
        eq(usagePeriodBalances.periodStart, periodStart),
      ),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Ensure a balance row exists for the account's current billing period.
 * Safe under concurrent callers via unique (account_id, period_start).
 */
export async function getOrCreateUsagePeriodBalance(
  account: HostingAccount,
  now = new Date(),
): Promise<UsagePeriodBalance> {
  const { periodStart, periodEnd } = currentBillingPeriod(account.periodAnchor, now);
  const existing = await getUsagePeriodBalance(account.id, periodStart);
  if (existing) {
    return existing;
  }

  const limitMicros = await resolveEffectiveLimitMicros(account);
  const voiceSecondsLimit = await resolveVoiceSecondsLimit(account);
  const createdAt = new Date();

  const [inserted] = await db()
    .insert(usagePeriodBalances)
    .values({
      id: createId(),
      accountId: account.id,
      periodStart,
      periodEnd,
      limitMicros,
      consumedMicros: 0,
      reservedMicros: 0,
      requestCount: 0,
      voiceSecondsLimit,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing({
      target: [usagePeriodBalances.accountId, usagePeriodBalances.periodStart],
    })
    .returning();

  if (inserted) {
    return inserted;
  }

  const raced = await getUsagePeriodBalance(account.id, periodStart);
  if (!raced) {
    throw new Error(`Failed to provision usage period balance for account ${account.id}.`);
  }

  return raced;
}

export function remainingMicros(balance: Pick<
  UsagePeriodBalance,
  "limitMicros" | "consumedMicros" | "reservedMicros"
>): number {
  return Math.max(0, balance.limitMicros - balance.consumedMicros - balance.reservedMicros);
}

export function usagePercent(balance: Pick<
  UsagePeriodBalance,
  "limitMicros" | "consumedMicros" | "reservedMicros"
>): number {
  if (balance.limitMicros <= 0) {
    return 100;
  }
  const used = balance.consumedMicros + balance.reservedMicros;
  return Math.min(100, (used / balance.limitMicros) * 100);
}
