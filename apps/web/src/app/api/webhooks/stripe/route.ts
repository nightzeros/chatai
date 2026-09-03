import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { requireStripe, handleStripeWebhookEvent } from "@/lib/hosting/stripe";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe sends webhook events here. The raw body is verified against the
 * webhook signing secret before any processing.
 *
 * IMPORTANT: This route must NOT use body-parsing middleware.
 * Next.js App Router does not parse by default — request.text() gives raw body.
 */
export async function POST(request: NextRequest) {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 },
    );
  }

  const rawBody = await request.text();
  const stripe = requireStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature." },
      { status: 400 },
    );
  }

  try {
    const result = await handleStripeWebhookEvent(event);
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (err) {
    console.error(`[stripe-webhook] Error handling ${event.type}:`, err);
    return NextResponse.json(
      { error: "Webhook handler error." },
      { status: 500 },
    );
  }
}
