import type { HostingPlanCode, PlanFeatures } from "@chatai/database";

import { env } from "@/lib/env";

import type { HostingAccount } from "./accounts";
import { getPlanEntitlement } from "./entitlements";
import { PLAN_CATALOG } from "./plan-catalog";

export type ResolvedEntitlements = {
  planCode: HostingPlanCode;
  monthlyLimitMicros: number;
  monthlyRequestCap: number | null;
  maxAssistants: number;
  evalsEnabled: boolean;
  teamMembers: boolean;
};

function catalogDefaults(planCode: HostingPlanCode): ResolvedEntitlements {
  const catalog = PLAN_CATALOG[planCode];
  return {
    planCode,
    monthlyLimitMicros: Math.round(catalog.hostedAiAllowanceUsd * 1_000_000),
    monthlyRequestCap: catalog.monthlyRequestCap,
    maxAssistants: catalog.maxAssistants,
    evalsEnabled: catalog.evalsEnabled,
    teamMembers: catalog.teamReady,
  };
}

function parseFeatures(
  features: PlanFeatures | Record<string, unknown> | null | undefined,
  fallback: ResolvedEntitlements,
): Pick<ResolvedEntitlements, "maxAssistants" | "evalsEnabled" | "teamMembers"> {
  const maxAssistants =
    typeof features?.maxAssistants === "number" && features.maxAssistants > 0
      ? features.maxAssistants
      : fallback.maxAssistants;

  const evalsEnabled =
    typeof features?.evalsEnabled === "boolean"
      ? features.evalsEnabled
      : // Legacy seed used `evals: true`
        typeof (features as { evals?: unknown } | null)?.evals === "boolean"
        ? Boolean((features as { evals: boolean }).evals)
        : fallback.evalsEnabled;

  const teamMembers =
    typeof features?.teamMembers === "boolean"
      ? features.teamMembers
      : fallback.teamMembers;

  return { maxAssistants, evalsEnabled, teamMembers };
}

/**
 * Resolve enforceable entitlements for an account.
 * Prefer these fields over `if (planCode === …)` checks.
 */
export async function resolveAccountEntitlements(
  account: Pick<HostingAccount, "planCode" | "limitOverrideMicros">,
): Promise<ResolvedEntitlements> {
  const fallback = catalogDefaults(account.planCode);
  const plan = await getPlanEntitlement(account.planCode);

  if (!plan) {
    return {
      ...fallback,
      monthlyLimitMicros:
        account.limitOverrideMicros ?? env.HOSTED_USAGE_DEFAULT_LIMIT_MICROS,
    };
  }

  const features = parseFeatures(plan.features, fallback);

  return {
    planCode: account.planCode,
    monthlyLimitMicros:
      account.limitOverrideMicros ?? plan.monthlyLimitMicros ?? fallback.monthlyLimitMicros,
    monthlyRequestCap: plan.monthlyRequestCap ?? fallback.monthlyRequestCap,
    ...features,
  };
}
