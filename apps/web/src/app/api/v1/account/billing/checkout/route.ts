import { NextResponse, type NextRequest } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { createCheckoutSession } from "@/lib/hosting/stripe/checkout";
import { getStripe } from "@/lib/hosting/stripe/client";

/**
 * POST /api/v1/account/billing/checkout
 * Body: { priceId: string, successUrl?: string, cancelUrl?: string }
 *
 * Creates a Stripe Checkout Session and returns the URL for redirect.
 */
export async function POST(request: NextRequest) {
  if (!getStripe()) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const priceId = body?.priceId;
  if (!priceId || typeof priceId !== "string") {
    return NextResponse.json({ error: "priceId is required." }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const successUrl = body?.successUrl ?? `${origin}/settings/billing?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = body?.cancelUrl ?? `${origin}/settings/billing`;

  try {
    const session = await createCheckoutSession({
      account: auth.account,
      userEmail: auth.session.user.email,
      priceId,
      successUrl,
      cancelUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] Failed:", err);
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }
}
