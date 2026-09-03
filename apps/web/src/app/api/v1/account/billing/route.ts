import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { resolveEffectiveLimitMicros } from "@/lib/hosting/entitlements";
import { getPolar } from "@/lib/hosting/polar/client";

/**
 * GET /api/v1/account/billing
 */
export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const { account } = auth;
  const effectiveLimitMicros = await resolveEffectiveLimitMicros(account);

  const billing: Record<string, unknown> = {
    planCode: account.planCode,
    effectiveLimitMicros,
    polarConfigured: Boolean(getPolar()),
    hasSubscription: Boolean(account.polarSubscriptionId),
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
