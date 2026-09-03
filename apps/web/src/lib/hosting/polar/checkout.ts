import type { HostingAccount } from "../accounts";
import { currentPolarProductAllowlist } from "./allowlist";
import { requirePolar } from "./client";
import { isAllowedPolarProductId } from "./plans";

export type CreateCheckoutInput = {
  account: HostingAccount;
  userEmail: string;
  productId: string;
  successUrl: string;
};

/**
 * Create a Polar Checkout Session for upgrading to a paid plan.
 * Uses hosting account id as externalCustomerId for webhook reconciliation.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<{ url: string }> {
  const polar = requirePolar();
  const allowlist = currentPolarProductAllowlist();
  if (allowlist.size === 0) {
    throw new Error(
      "Polar plan products are not configured. Set POLAR_PRODUCT_ID_PRO / POLAR_PRODUCT_ID_TEAM.",
    );
  }
  if (!isAllowedPolarProductId(input.productId, allowlist)) {
    throw new Error("Product is not an allowed ChatAI plan.");
  }

  const checkout = await polar.checkouts.create({
    products: [input.productId],
    externalCustomerId: input.account.id,
    customerEmail: input.userEmail,
    successUrl: input.successUrl,
    metadata: { hosting_account_id: input.account.id },
  });

  if (!checkout.url) {
    throw new Error("Polar checkout did not return a URL.");
  }

  return { url: checkout.url };
}
