import { eq, planEntitlements, type HostingPlanCode } from "@chatai/database";

import { db } from "@/lib/db";
import { env } from "@/lib/env";

import type { HostingAccount } from "./accounts";

export type PlanEntitlement = typeof planEntitlements.$inferSelect;

/** Fallback when `plan_entitlements` row is missing (should not happen after migration seed). */
export function defaultLimitMicrosFromEnv(): number {
  return env.HOSTED_USAGE_DEFAULT_LIMIT_MICROS;
}

export async function getPlanEntitlement(
  planCode: HostingPlanCode,
): Promise<PlanEntitlement | null> {
  const [row] = await db()
    .select()
    .from(planEntitlements)
    .where(eq(planEntitlements.planCode, planCode))
    .limit(1);

  return row ?? null;
}

/**
 * Effective monthly cost ceiling for an account, in micro-dollars.
 * Precedence: account override → plan entitlement → env default.
 */
export async function resolveEffectiveLimitMicros(
  account: Pick<HostingAccount, "planCode" | "limitOverrideMicros">,
): Promise<number> {
  if (account.limitOverrideMicros != null) {
    return account.limitOverrideMicros;
  }

  const plan = await getPlanEntitlement(account.planCode);
  if (plan) {
    return plan.monthlyLimitMicros;
  }

  return defaultLimitMicrosFromEnv();
}

export async function resolvePlanRequestCap(
  account: Pick<HostingAccount, "planCode">,
): Promise<number | null> {
  const plan = await getPlanEntitlement(account.planCode);
  return plan?.monthlyRequestCap ?? null;
}
