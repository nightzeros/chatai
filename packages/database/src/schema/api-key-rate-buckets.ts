import { relations } from "drizzle-orm";
import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { apiKeys } from "./api-keys";

export const apiKeyRateBuckets = pgTable(
  "api_key_rate_buckets",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    /** Truncated to the start of the minute window. */
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.apiKeyId, table.windowStart] })],
);

export const apiKeyRateBucketsRelations = relations(apiKeyRateBuckets, ({ one }) => ({
  apiKey: one(apiKeys, {
    fields: [apiKeyRateBuckets.apiKeyId],
    references: [apiKeys.id],
  }),
}));
