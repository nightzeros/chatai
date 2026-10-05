import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

export const AUDIT_ACTIONS = [
  "login",
  "logout",
  "password_reset_requested",
  "password_reset_completed",
  "assistant_created",
  "assistant_deleted",
  "assistant_settings_updated",
  "document_deleted",
  "source_deleted",
  "conversation_deleted",
  "conversation_exported",
  "api_key_created",
  "api_key_revoked",
  "account_deleted",
  "security_settings_updated",
  "privacy_settings_updated",
  "voice_settings_updated",
  "assistant_profile_updated",
  "assistant_profile_refreshed",
  "usage_limit_updated",
  "usage_credit_applied",
  "account_suspended",
  "account_status_updated",
  "polar_subscription_synced",
  "polar_payment_failed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").$type<AuditAction>().notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    /** No IP addresses or raw secrets. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_user_id_created_at_idx").on(table.userId, table.createdAt)],
);

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  user: one(user, {
    fields: [auditEvents.userId],
    references: [user.id],
  }),
}));
