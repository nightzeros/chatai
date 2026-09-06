import { NextResponse, type NextRequest } from "next/server";

import { requireAccountSession } from "@/lib/hosting/require-account-session";
import { currentPolarPlanProductMap } from "@/lib/hosting/polar/allowlist";
import { createCheckoutSession } from "@/lib/hosting/polar/checkout";
import { getPolar } from "@/lib/hosting/polar/client";
import { isPaidPlanCode, productIdForPlanCode } from "@/lib/hosting/polar/plans";
import {
  defaultCheckoutSuccessUrl,
  resolveSameOriginUrl,
} from "@/lib/hosting/polar/urls";

/**
 * POST /api/v1/account/billing/checkout
 * Body: { planCode: "starter"|"pro"|"business", successUrl?: string }
 *
 * Server resolves Polar product from planCode. Client product IDs are ignored.
 */
export async function POST(request: NextRequest) {
  if (!getPolar()) {
    return NextResponse.json({ error: "Polar is not configured." }, { status: 503 });
  }

  const planProducts = currentPolarPlanProductMap();
  if (planProducts.size === 0) {
    return NextResponse.json(
      { error: "Polar plan products are not configured." },
      { status: 503 },
    );
  }

  const auth = await requireAccountSession();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const planCode = body?.planCode;
  if (!planCode || typeof planCode !== "string" || !isPaidPlanCode(planCode)) {
    return NextResponse.json(
      { error: "planCode must be starter, pro, or business." },
      { status: 400 },
    );
  }

  if (!productIdForPlanCode(planCode, planProducts)) {
    return NextResponse.json(
      { error: `Polar product is not configured for plan "${planCode}".` },
      { status: 503 },
    );
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
      planCode,
      successUrl,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] Failed:", err);
    return NextResponse.json({ error: "Failed to create checkout session." }, { status: 500 });
  }
}
