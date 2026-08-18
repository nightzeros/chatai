import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import type { ApiKeyScope } from "./api-key-scopes";

export { API_KEY_SCOPES, type ApiKeyScope } from "./api-key-scopes";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Display prefix, e.g. `sk_live_ab12`. */
    keyPrefix: text("key_prefix").notNull(),
    /** SHA-256 hex digest of the full secret. */
    keyHash: text("key_hash").notNull().unique(),
    scopes: jsonb("scopes").$type<ApiKeyScope[]>().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("api_keys_user_id_idx").on(table.userId)],
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(user, {
    fields: [apiKeys.userId],
    references: [user.id],
  }),
}));
