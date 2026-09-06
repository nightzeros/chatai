/**
 * Marketing / UI catalog for plans. Enforceable limits live in `plan_entitlements`
 * (DB). Display prices must be kept in sync with Polar Products operationally.
 *
 * This module is client-safe: do not import `@chatai/database` (pulls postgres/fs).
 */

export const HOSTING_PLAN_CODES = ["free", "starter", "pro", "business"] as const;
export type HostingPlanCode = (typeof HOSTING_PLAN_CODES)[number];

export const PAID_HOSTING_PLAN_CODES = ["starter", "pro", "business"] as const;
export type PaidHostingPlanCode = (typeof PAID_HOSTING_PLAN_CODES)[number];

export type PlanCatalogEntry = {
  planCode: HostingPlanCode;
  name: string;
  /** Display price in USD cents (0 for Free). Not the Polar charge source of truth. */
  displayPriceCents: number;
  blurb: string;
  /** Customer-facing bullets for the billing page. */
  highlights: string[];
  /** Included hosted AI allowance shown to customers (USD). */
  hostedAiAllowanceUsd: number;
  maxAssistants: number;
  monthlyRequestCap: number;
  evalsEnabled: boolean;
  teamReady: boolean;
};

export const PLAN_CATALOG: Record<HostingPlanCode, PlanCatalogEntry> = {
  free: {
    planCode: "free",
    name: "Free",
    displayPriceCents: 0,
    blurb: "Try ChatAI and build one assistant.",
    highlights: [
      "$1 hosted AI included / month",
      "1 assistant",
      "75 chats/requests / month",
      "Widget + API access",
    ],
    hostedAiAllowanceUsd: 1,
    maxAssistants: 1,
    monthlyRequestCap: 75,
    evalsEnabled: false,
    teamReady: false,
  },
  starter: {
    planCode: "starter",
    name: "Starter",
    displayPriceCents: 1900,
    blurb: "For personal sites and small projects.",
    highlights: [
      "$12 hosted AI included / month",
      "5 assistants",
      "2,000 chats/requests / month",
      "Widget + API access",
    ],
    hostedAiAllowanceUsd: 12,
    maxAssistants: 5,
    monthlyRequestCap: 2000,
    evalsEnabled: false,
    teamReady: false,
  },
  pro: {
    planCode: "pro",
    name: "Pro",
    displayPriceCents: 4900,
    blurb: "For production sites and agencies.",
    highlights: [
      "$45 hosted AI included / month",
      "20 assistants",
      "15,000 chats/requests / month",
      "Evaluation tools",
    ],
    hostedAiAllowanceUsd: 45,
    maxAssistants: 20,
    monthlyRequestCap: 15000,
    evalsEnabled: true,
    teamReady: false,
  },
  business: {
    planCode: "business",
    name: "Business",
    displayPriceCents: 14900,
    blurb: "For teams and multi-site usage.",
    highlights: [
      "$150 hosted AI included / month",
      "100 assistants",
      "50,000 chats/requests / month",
      "Evaluation tools · Team-ready",
    ],
    hostedAiAllowanceUsd: 150,
    maxAssistants: 100,
    monthlyRequestCap: 50000,
    evalsEnabled: true,
    teamReady: true,
  },
};

export const ALL_PLAN_CODES: readonly HostingPlanCode[] = HOSTING_PLAN_CODES;
export const PAID_PLAN_CODES: readonly PaidHostingPlanCode[] = PAID_HOSTING_PLAN_CODES;

export function isHostingPlanCode(value: string): value is HostingPlanCode {
  return (HOSTING_PLAN_CODES as readonly string[]).includes(value);
}

export function isPaidPlanCode(value: string): value is PaidHostingPlanCode {
  return (PAID_HOSTING_PLAN_CODES as readonly string[]).includes(value);
}

export function getPlanCatalogEntry(planCode: HostingPlanCode): PlanCatalogEntry {
  return PLAN_CATALOG[planCode];
}

export function formatDisplayPrice(cents: number): string {
  if (cents <= 0) return "$0";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
