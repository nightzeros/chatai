import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Idempotency guard for Polar webhook events.
 * INSERT … ON CONFLICT DO NOTHING — if inserted, process; if not, skip.
 */
export const polarEvents = pgTable("polar_events", {
  /** Polar event ID. */
  id: text("id").primaryKey(),
  /** Event type for observability (e.g. subscription.updated). */
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
