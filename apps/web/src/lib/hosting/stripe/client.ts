import Stripe from "stripe";

import { env } from "@/lib/env";

let _stripe: Stripe | null = null;

/**
 * Lazily initialized Stripe client. Returns null when STRIPE_SECRET_KEY is not configured.
 */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-08-26.dahlia",
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Returns the Stripe client or throws if not configured.
 */
export function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  return stripe;
}
