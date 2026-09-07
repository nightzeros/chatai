import type { PaidHostingPlanCode } from "@chatai/database";

import type { HostingAccount } from "../accounts";
import { currentPolarPlanProductMap } from "./allowlist";
import { requirePolar } from "./client";
import { isPaidPlanCode, productIdForPlanCode } from "./plans";

export type CreateCheckoutInput = {
  account: HostingAccount;
  userEmail: string;
  planCode: PaidHostingPlanCode;
  successUrl: string;
};

/**
 * Create a Polar Checkout Session for upgrading to a paid plan.
 * Resolves Polar product from internal planCode — never trusts client product IDs.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<{ url: string }> {
  const polar = requirePolar();

  if (!isPaidPlanCode(input.planCode)) {
    throw new Error("Plan is not a paid ChatAI plan.");
  }

  const planProducts = currentPolarPlanProductMap();
  const productId = productIdForPlanCode(input.planCode, planProducts);
  if (!productId) {
    throw new Error(
      `Polar product is not configured for plan "${input.planCode}". Set POLAR_PRODUCT_ID_${input.planCode.toUpperCase()}.`,
    );
  }

  const checkout = await polar.checkouts.create({
    products: [productId],
    externalCustomerId: input.account.id,
    customerEmail: input.userEmail,
    successUrl: input.successUrl,
    metadata: {
      hosting_account_id: input.account.id,
      plan_code: input.planCode,
    },
  });

  if (!checkout.url) {
    throw new Error("Polar checkout did not return a URL.");
  }

  return { url: checkout.url };
}
