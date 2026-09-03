import { NextResponse, type NextRequest } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { createPortalSession } from "@/lib/hosting/stripe/checkout";
import { getStripe } from "@/lib/hosting/stripe/client";

/**
 * POST /api/v1/account/billing/portal
 * Body: { returnUrl?: string }
 *
 * Creates a Stripe Customer Portal session for managing the subscription.
 * Requires the account to have a linked Stripe customer.
 */
export async function POST(request: NextRequest) {
  if (!getStripe()) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  if (!auth.account.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account. Subscribe to a plan first." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const origin = request.nextUrl.origin;
  const returnUrl = body?.returnUrl ?? `${origin}/settings/billing`;

  try {
    const session = await createPortalSession({
      stripeCustomerId: auth.account.stripeCustomerId,
      returnUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] Failed:", err);
    return NextResponse.json({ error: "Failed to create portal session." }, { status: 500 });
  }
}
