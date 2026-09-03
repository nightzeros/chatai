import { relations } from "drizzle-orm";
import {
  bigint,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const HOSTING_ACCOUNT_STATUSES = ["active", "suspended", "disabled"] as const;
export type HostingAccountStatus = (typeof HOSTING_ACCOUNT_STATUSES)[number];

export const hostingAccountStatusEnum = pgEnum("hosting_account_status", [
  ...HOSTING_ACCOUNT_STATUSES,
]);

export const HOSTING_PLAN_CODES = ["free", "pro", "team"] as const;
export type HostingPlanCode = (typeof HOSTING_PLAN_CODES)[number];

/**
 * Billable hosting account for ChatAI Cloud usage.
 * 1:1 with `user` in Phase 1; org/team ownership can extend this later.
 */
export const hostingAccounts = pgTable(
  "hosting_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: hostingAccountStatusEnum("status").notNull().default("active"),
    planCode: text("plan_code").$type<HostingPlanCode>().notNull().default("free"),
    /** Billing period anchor (UTC). Stripe can align this later. */
    periodAnchor: timestamp("period_anchor", { withTimezone: true }).notNull(),
    /** Admin override in micro-dollars. Null uses plan entitlement defaults (Task 2). */
    limitOverrideMicros: bigint("limit_override_micros", { mode: "number" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("hosting_accounts_user_id_uidx").on(table.userId)],
);

export const hostingAccountsRelations = relations(hostingAccounts, ({ one }) => ({
  user: one(user, {
    fields: [hostingAccounts.userId],
    references: [user.id],
  }),
}));
