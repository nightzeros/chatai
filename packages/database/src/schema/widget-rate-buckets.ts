import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** `visitor` → scopeKey = `${assistantId}:${visitorId}`; `assistant` → `${assistantId}`. */
export type WidgetRateScope = "visitor" | "assistant";

export const widgetRateBuckets = pgTable(
  "widget_rate_buckets",
  {
    scope: text("scope").$type<WidgetRateScope>().notNull(),
    scopeKey: text("scope_key").notNull(),
    /** Truncated to the start of the minute window. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.scopeKey, table.windowStart] }),
  ],
);
