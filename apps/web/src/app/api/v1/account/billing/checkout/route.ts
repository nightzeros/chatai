import { NextResponse, type NextRequest } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { currentPolarProductAllowlist } from "@/lib/hosting/polar/allowlist";
import { createCheckoutSession } from "@/lib/hosting/polar/checkout";
import { getPolar } from "@/lib/hosting/polar/client";
import { isAllowedPolarProductId } from "@/lib/hosting/polar/plans";
import {
  defaultCheckoutSuccessUrl,
  resolveSameOriginUrl,
} from "@/lib/hosting/polar/urls";

/**
 * POST /api/v1/account/billing/checkout
 * Body: { productId: string, successUrl?: string }
 */
export async function POST(request: NextRequest) {
  if (!getPolar()) {
    return NextResponse.json({ error: "Polar is not configured." }, { status: 503 });
  }

  if (currentPolarProductAllowlist().size === 0) {
    return NextResponse.json(
      { error: "Polar plan products are not configured." },
      { status: 503 },
    );
  }

  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const productId = body?.productId;
  if (!productId || typeof productId !== "string") {
    return NextResponse.json({ error: "productId is required." }, { status: 400 });
  }
  if (!isAllowedPolarProductId(productId, currentPolarProductAllowlist())) {
    return NextResponse.json({ error: "Unknown productId." }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const successUrl = resolveSameOriginUrl(
    origin,
    body?.successUrl,
    defaultCheckoutSuccessUrl(origin),
  );
  if (!successUrl) {
    return NextResponse.json(
      { error: "successUrl must be same-origin." },
      { status: 400 },
    );
  }

  try {
    const session = await createCheckoutSession({
      account: auth.account,
      userEmail: auth.session.user.email,
      productId,
      successUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] Failed:", err);
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }
}
