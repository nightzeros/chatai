import {
  bigint,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { HostingPlanCode } from "./hosting-accounts";

/**
 * Typed plan feature flags stored in `plan_entitlements.features`.
 * Prefer reading via the app entitlements resolver — never `if (plan === "pro")`.
 */
export type PlanFeatures = {
  maxAssistants: number;
  evalsEnabled: boolean;
  /** UI/entitlement flag only; seat billing is not implemented. */
  teamMembers?: boolean;
  /** Monthly customer Voice minutes (provisional). null = unlimited, 0 = not included. */
  voiceMinutesMonthly?: number | null;
  /** Concurrent Voice sessions per account (provisional). null = unlimited. */
  maxConcurrentVoiceSessions?: number | null;
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
  features: jsonb("features").$type<PlanFeatures>().notNull().default({
    maxAssistants: 1,
    evalsEnabled: false,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
