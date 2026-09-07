import { NextResponse, type NextRequest } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { getPolar } from "@/lib/hosting/polar/client";
import { createPortalSession } from "@/lib/hosting/polar/portal";
import {
  defaultBillingReturnUrl,
  resolveSameOriginUrl,
} from "@/lib/hosting/polar/urls";

/**
 * POST /api/v1/account/billing/portal
 * Body: { returnUrl?: string }
 */
export async function POST(request: NextRequest) {
  if (!getPolar()) {
    return NextResponse.json({ error: "Polar is not configured." }, { status: 503 });
  }

  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  if (!auth.account.polarCustomerId) {
    return NextResponse.json(
      { error: "No billing account. Subscribe to a plan first." },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  const origin = request.nextUrl.origin;
  const returnUrl = resolveSameOriginUrl(
    origin,
    body?.returnUrl,
    defaultBillingReturnUrl(origin),
  );
  if (!returnUrl) {
    return NextResponse.json(
      { error: "returnUrl must be same-origin." },
      { status: 400 },
    );
  }

  try {
    const session = await createPortalSession({
      polarCustomerId: auth.account.polarCustomerId,
      returnUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] Failed:", err);
    return NextResponse.json({ error: "Failed to create portal session." }, { status: 500 });
  }
}
