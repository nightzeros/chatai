import { relations } from "drizzle-orm";
import {
  bigint,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { hostingAccounts } from "./hosting-accounts";

/**
 * Authoritative per-account usage counter for a billing period.
 * Reservation / reconciliation (Task 6) updates reserved_micros and consumed_micros atomically.
 */
export const usagePeriodBalances = pgTable(
  "usage_period_balances",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => hostingAccounts.id, { onDelete: "cascade" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    /** Effective limit for this period (plan default or account override at period open). */
    limitMicros: bigint("limit_micros", { mode: "number" }).notNull(),
    consumedMicros: bigint("consumed_micros", { mode: "number" }).notNull().default(0),
    reservedMicros: bigint("reserved_micros", { mode: "number" }).notNull().default(0),
    requestCount: integer("request_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_period_balances_account_period_uidx").on(
      table.accountId,
      table.periodStart,
    ),
  ],
);

export const usagePeriodBalancesRelations = relations(usagePeriodBalances, ({ one }) => ({
  account: one(hostingAccounts, {
    fields: [usagePeriodBalances.accountId],
    references: [hostingAccounts.id],
  }),
}));
