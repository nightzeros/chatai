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
  /** Customer Voice minutes per period (provisional). null = unlimited, 0 = not included. */
  voiceMinutesMonthly: number | null;
  /** Concurrent Voice sessions per account (provisional). null = unlimited. */
  maxConcurrentVoiceSessions: number | null;
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
    voiceMinutesMonthly: catalog.voiceMinutesMonthly,
    maxConcurrentVoiceSessions: catalog.maxConcurrentVoiceSessions,
  };
}

/** Explicit non-negative integer or null (unlimited) from features; absent keys fall back. */
function nullableCount(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function parseFeatures(
  features: PlanFeatures | Record<string, unknown> | null | undefined,
  fallback: ResolvedEntitlements,
): Omit<ResolvedEntitlements, "planCode" | "monthlyLimitMicros" | "monthlyRequestCap"> {
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

  return {
    maxAssistants,
    evalsEnabled,
    teamMembers,
    voiceMinutesMonthly: nullableCount(
      features?.voiceMinutesMonthly,
      fallback.voiceMinutesMonthly,
    ),
    maxConcurrentVoiceSessions: nullableCount(
      features?.maxConcurrentVoiceSessions,
      fallback.maxConcurrentVoiceSessions,
    ),
  };
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

/** Voice-second entitlement frozen into a period balance; null = unlimited. */
export async function resolveVoiceSecondsLimit(
  account: Pick<HostingAccount, "planCode" | "limitOverrideMicros">,
): Promise<number | null> {
  const { voiceMinutesMonthly } = await resolveAccountEntitlements(account);
  return voiceMinutesMonthly == null ? null : voiceMinutesMonthly * 60;
}
