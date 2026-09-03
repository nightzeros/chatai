import type { HostingPlanCode } from "@chatai/database";

export type PaidPlanCode = Extract<HostingPlanCode, "pro" | "team">;

export function parsePolarProductAllowlist(input: {
  proProductId?: string;
  teamProductId?: string;
}): Map<string, PaidPlanCode> {
  const map = new Map<string, PaidPlanCode>();
  const pro = input.proProductId?.trim();
  const team = input.teamProductId?.trim();
  if (pro) map.set(pro, "pro");
  if (team) map.set(team, "team");
  return map;
}

export function planCodeForProductId(
  productId: string | null | undefined,
  allowlist: Map<string, PaidPlanCode>,
): PaidPlanCode | null {
  if (!productId) return null;
  return allowlist.get(productId) ?? null;
}

export function isAllowedPolarProductId(
  productId: string,
  allowlist: Map<string, PaidPlanCode>,
): boolean {
  return allowlist.has(productId);
}

/** When a subscription is revoked/canceled, revert to free. */
export const CANCELED_PLAN_CODE: HostingPlanCode = "free";
