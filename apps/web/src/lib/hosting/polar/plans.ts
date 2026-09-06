import type { HostingPlanCode, PaidHostingPlanCode } from "@chatai/database";
import { PAID_HOSTING_PLAN_CODES } from "@chatai/database";

export type { PaidHostingPlanCode };

export type PolarProductConfig = {
  starterProductId?: string;
  proProductId?: string;
  businessProductId?: string;
  /** @deprecated Prefer POLAR_PRODUCT_ID_BUSINESS. Maps to business for one release. */
  teamProductId?: string;
};

/**
 * Build productId → paid planCode allowlist for webhook reconciliation.
 */
export function parsePolarProductAllowlist(
  input: PolarProductConfig,
): Map<string, PaidHostingPlanCode> {
  const map = new Map<string, PaidHostingPlanCode>();
  const starter = input.starterProductId?.trim();
  const pro = input.proProductId?.trim();
  const business =
    input.businessProductId?.trim() || input.teamProductId?.trim() || "";

  if (starter) map.set(starter, "starter");
  if (pro) map.set(pro, "pro");
  if (business) map.set(business, "business");
  return map;
}

/**
 * Build planCode → productId map for checkout (server-side only).
 */
export function parsePolarPlanProductMap(
  input: PolarProductConfig,
): Map<PaidHostingPlanCode, string> {
  const map = new Map<PaidHostingPlanCode, string>();
  const starter = input.starterProductId?.trim();
  const pro = input.proProductId?.trim();
  const business =
    input.businessProductId?.trim() || input.teamProductId?.trim() || "";

  if (starter) map.set("starter", starter);
  if (pro) map.set("pro", pro);
  if (business) map.set("business", business);
  return map;
}

export function planCodeForProductId(
  productId: string | null | undefined,
  allowlist: Map<string, PaidHostingPlanCode>,
): PaidHostingPlanCode | null {
  if (!productId) return null;
  return allowlist.get(productId) ?? null;
}

export function productIdForPlanCode(
  planCode: PaidHostingPlanCode,
  planProducts: Map<PaidHostingPlanCode, string>,
): string | null {
  return planProducts.get(planCode) ?? null;
}

export function isPaidPlanCode(value: string): value is PaidHostingPlanCode {
  return (PAID_HOSTING_PLAN_CODES as readonly string[]).includes(value);
}

export function isAllowedPolarProductId(
  productId: string,
  allowlist: Map<string, PaidHostingPlanCode>,
): boolean {
  return allowlist.has(productId);
}

/** When a subscription is revoked/canceled, revert to free. */
export const CANCELED_PLAN_CODE: HostingPlanCode = "free";
