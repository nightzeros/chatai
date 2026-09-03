import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { HostingPlanCode } from "./hosting-accounts";

export type PlanFeatures = {
  /** Reserved for future feature flags (evals, max assistants, etc.). */
  [key: string]: unknown;
};

/**
 * Plan → monthly allowance mapping. Polar Product IDs map via env allowlist.
 * `hosting_accounts.plan_code` references these rows by convention (soft FK).
 */
export const planEntitlements = pgTable("plan_entitlements", {
  planCode: text("plan_code").$type<HostingPlanCode>().primaryKey(),
  /** Default monthly provider-cost ceiling in micro-dollars. */
  monthlyLimitMicros: bigint("monthly_limit_micros", { mode: "number" }).notNull(),
  /** Optional secondary request-count backstop. Null = unlimited requests. */
  monthlyRequestCap: integer("monthly_request_cap"),
  features: jsonb("features").$type<PlanFeatures>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
