import { NextResponse } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { resolveEffectiveLimitMicros } from "@/lib/hosting/entitlements";
import { getStripe } from "@/lib/hosting/stripe/client";

/**
 * GET /api/v1/account/billing
 *
 * Returns the current billing/subscription status for the authenticated account.
 */
export async function GET() {
  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const { account } = auth;
  const effectiveLimitMicros = await resolveEffectiveLimitMicros(account);

  const billing: Record<string, unknown> = {
    planCode: account.planCode,
    effectiveLimitMicros,
    stripeConfigured: Boolean(getStripe()),
    hasSubscription: Boolean(account.stripeSubscriptionId),
  };

  if (account.stripeSubscriptionId && getStripe()) {
    try {
      const stripe = getStripe()!;
      const sub = await stripe.subscriptions.retrieve(account.stripeSubscriptionId);
      billing.subscription = {
        id: sub.id,
        status: sub.status,
        billingCycleAnchor: sub.billing_cycle_anchor,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cancelAt: sub.cancel_at ?? null,
        canceledAt: sub.canceled_at ?? null,
      };
    } catch (err) {
      console.warn("[billing] Failed to fetch subscription:", err);
      billing.subscriptionError = "Could not fetch subscription details.";
    }
  }

  return NextResponse.json(billing);
}
