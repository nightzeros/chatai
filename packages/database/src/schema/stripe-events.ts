import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Idempotency guard for Stripe webhook events.
 * INSERT … ON CONFLICT DO NOTHING — if inserted, process; if not, skip.
 */
export const stripeEvents = pgTable(
  "stripe_events",
  {
    /** Stripe event ID (evt_…). */
    id: text("id").primaryKey(),
    /** Event type for observability (e.g. invoice.paid). */
    type: text("type").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
