import type Stripe from "stripe";

import { requireStripe } from "./client";
import type { HostingAccount } from "../accounts";

export type CreateCheckoutInput = {
  account: HostingAccount;
  userEmail: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Create a Stripe Checkout Session for upgrading to a paid plan.
 * Reuses existing Stripe customer if the account already has one.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<Stripe.Checkout.Session> {
  const stripe = requireStripe();

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    subscription_data: {
      metadata: { hosting_account_id: input.account.id },
    },
    metadata: { hosting_account_id: input.account.id },
  };

  if (input.account.stripeCustomerId) {
    params.customer = input.account.stripeCustomerId;
  } else {
    params.customer_email = input.userEmail;
    params.customer_creation = "always";
  }

  return stripe.checkout.sessions.create(params);
}

export type CreatePortalInput = {
  stripeCustomerId: string;
  returnUrl: string;
};

/**
 * Create a Stripe Customer Portal session for managing subscriptions.
 */
export async function createPortalSession(
  input: CreatePortalInput,
): Promise<Stripe.BillingPortal.Session> {
  const stripe = requireStripe();

  return stripe.billingPortal.sessions.create({
    customer: input.stripeCustomerId,
    return_url: input.returnUrl,
  });
}
