import type { HostingPlanCode } from "@chatai/database";

export type PaidPlanCode = Extract<HostingPlanCode, "pro" | "team">;

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
 * Resolve plan code from Stripe Price metadata.
 * Metadata is informational only — entitlements must come from the Price ID allowlist.
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

export function parseStripePriceAllowlist(input: {
  proPriceId?: string;
  teamPriceId?: string;
}): Map<string, PaidPlanCode> {
  const map = new Map<string, PaidPlanCode>();
  const pro = input.proPriceId?.trim();
  const team = input.teamPriceId?.trim();
  if (pro) map.set(pro, "pro");
  if (team) map.set(team, "team");
  return map;
}

export function planCodeForPriceId(
  priceId: string | null | undefined,
  allowlist: Map<string, PaidPlanCode>,
): PaidPlanCode | null {
  if (!priceId) return null;
  return allowlist.get(priceId) ?? null;
}

export function isAllowedStripePriceId(
  priceId: string,
  allowlist: Map<string, PaidPlanCode>,
): boolean {
  return allowlist.has(priceId);
}

/**
 * When a subscription is canceled or expires, revert to free.
 */
export const CANCELED_PLAN_CODE: HostingPlanCode = "free";
