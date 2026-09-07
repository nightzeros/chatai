import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { countAssistantsForUser } from "@/lib/hosting/assistant-limits";
import { resolveEffectiveLimitMicros } from "@/lib/hosting/entitlements";
import { currentPolarPlanProductMap } from "@/lib/hosting/polar/allowlist";
import { getPolar } from "@/lib/hosting/polar/client";
import { ALL_PLAN_CODES, PLAN_CATALOG } from "@/lib/hosting/plan-catalog";
import { resolveAccountEntitlements } from "@/lib/hosting/plan-entitlements";

/**
 * GET /api/v1/account/billing
 */
export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const { account, session } = auth;
  const [effectiveLimitMicros, entitlements, assistantCount] = await Promise.all([
    resolveEffectiveLimitMicros(account),
    resolveAccountEntitlements(account),
    countAssistantsForUser(session.user.id),
  ]);

  const planProducts = currentPolarPlanProductMap();
  const configuredPaidPlans = [...planProducts.keys()];

  const billing: Record<string, unknown> = {
    planCode: account.planCode,
    effectiveLimitMicros,
    entitlements: {
      monthlyLimitMicros: entitlements.monthlyLimitMicros,
      monthlyRequestCap: entitlements.monthlyRequestCap,
      maxAssistants: entitlements.maxAssistants,
      evalsEnabled: entitlements.evalsEnabled,
      teamMembers: entitlements.teamMembers,
    },
    assistantCount,
    polarConfigured: Boolean(getPolar()),
    hasSubscription: Boolean(account.polarSubscriptionId),
    configuredPaidPlans,
    plans: ALL_PLAN_CODES.map((code) => ({
      ...PLAN_CATALOG[code],
      productConfigured:
        code === "free" || configuredPaidPlans.includes(code as (typeof configuredPaidPlans)[number]),
    })),
  };

  if (account.polarSubscriptionId && getPolar()) {
    try {
      const polar = getPolar()!;
      const sub = await polar.subscriptions.get({ id: account.polarSubscriptionId });
      billing.subscription = {
        id: sub.id,
        status: sub.status,
        currentPeriodStart: sub.currentPeriodStart?.toISOString?.() ?? sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString?.() ?? sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        canceledAt: sub.canceledAt ?? null,
        productId: sub.productId,
      };
    } catch (err) {
      console.warn("[billing] Failed to fetch subscription:", err);
      billing.subscriptionError = "Could not fetch subscription details.";
    }
  }

  return NextResponse.json(billing);
}
