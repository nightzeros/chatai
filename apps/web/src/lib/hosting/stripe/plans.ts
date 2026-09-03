import type { HostingPlanCode } from "@chatai/database";

/**
 * Map Stripe Price IDs to internal plan codes.
 * Configure these in your Stripe dashboard → Products → Pricing.
 * Each price should have metadata.plan_code = "pro" | "team".
 */
export type StripePlanMapping = {
  priceId: string;
  planCode: HostingPlanCode;
  name: string;
  monthlyLimitMicros: number;
};

/**
 * Resolve plan code from a Stripe Price ID.
 * Checks price metadata first (plan_code), then falls back to known mappings.
 */
export function planCodeFromPriceMetadata(
  metadata: Record<string, string> | null | undefined,
): HostingPlanCode | null {
  const code = metadata?.plan_code;
  if (code === "pro" || code === "team" || code === "free") {
    return code;
  }
  return null;
}

/**
 * When a subscription is canceled or expires, revert to free.
 */
export const CANCELED_PLAN_CODE: HostingPlanCode = "free";
