import { NextResponse, type NextRequest } from "next/server";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";

import { env } from "@/lib/env";
import { handlePolarWebhookEvent } from "@/lib/hosting/polar/webhook-handler";

/**
 * POST /api/webhooks/polar
 *
 * Polar sends webhook events here. The raw body is verified with the
 * webhook signing secret before any processing.
 */
export async function POST(request: NextRequest) {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "Polar is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event;
  try {
    event = validateEvent(rawBody, headers, env.POLAR_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.error("[polar-webhook] Signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    }
    console.error("[polar-webhook] Event parse failed:", err);
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  const eventId =
    headers["webhook-id"] ??
    headers["Webhook-Id"] ??
    `${event.type}:${JSON.stringify((event as { data?: { id?: string } }).data?.id ?? "")}:${
      event.timestamp instanceof Date
        ? event.timestamp.toISOString()
        : String(event.timestamp ?? "")
    }`;

  try {
    const result = await handlePolarWebhookEvent(event, eventId);
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (err) {
    console.error(`[polar-webhook] Error handling ${event.type}:`, err);
    return NextResponse.json(
      { error: "Webhook handler error." },
      { status: 500 },
    );
  }
}
