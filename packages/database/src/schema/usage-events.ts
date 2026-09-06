import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { hostingAccounts } from "./hosting-accounts";

export const USAGE_OPERATIONS = ["chat_completion", "embedding", "rerank"] as const;
export type UsageOperation = (typeof USAGE_OPERATIONS)[number];

export const usageOperationEnum = pgEnum("usage_operation", [...USAGE_OPERATIONS]);

export const USAGE_BILLING_MODES = ["hosted", "byok"] as const;
export type UsageBillingMode = (typeof USAGE_BILLING_MODES)[number];

export const usageBillingModeEnum = pgEnum("usage_billing_mode", [...USAGE_BILLING_MODES]);

export const USAGE_EVENT_STATUSES = [
  "shadow",
  "reserved",
  "completed",
  "failed",
  "abandoned",
  "refunded",
] as const;
export type UsageEventStatus = (typeof USAGE_EVENT_STATUSES)[number];

export const usageEventStatusEnum = pgEnum("usage_event_status", [...USAGE_EVENT_STATUSES]);

/** One rate component applied when computing final_cost_micros. */
export type UsagePricingRateSnapshot = {
  pricingOperation: "chat_input" | "chat_output" | "chat_cached_input" | "embedding" | "rerank";
  priceMicrosPerUnit: number;
  unit: "per_million_tokens" | "per_request" | "per_1k_tokens";
  effectiveFrom?: string;
};

/**
 * Immutable copy of the rates used to compute final_cost_micros.
 * Chat completions may include input + output + cached rates.
 */
export type UsagePricingSnapshot = {
  provider: string;
  model?: string | null;
  usageOperation: UsageOperation;
  rates: UsagePricingRateSnapshot[];
  /** True when no catalog rate matched; cost was treated as 0. */
  unknownPricing?: boolean;
};

/**
 * Safe billing metadata only — never store message content, prompts, or chunk text.
 */
export type UsageEventMetadata = {
  source?: "playground" | "widget" | "api" | "ingest" | "eval";
  visitorIdHash?: string;
  parentEventId?: string;
  [key: string]: unknown;
};

/**
 * Append-only usage ledger. One top-level reservation may own several child events
 * (rewrite / embed / answer) sharing the same request_id.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => hostingAccounts.id, { onDelete: "cascade" }),
    assistantId: text("assistant_id").references(() => assistants.id, { onDelete: "set null" }),
    /** Correlates all provider sub-calls for a single user-facing request. */
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    operation: usageOperationEnum("operation").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    billingMode: usageBillingModeEnum("billing_mode").notNull().default("hosted"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    /** Non-token units (e.g. Cohere rerank requests, embedding batches). */
    units: integer("units").notNull().default(0),
    reservedCostMicros: bigint("reserved_cost_micros", { mode: "number" }).notNull().default(0),
    finalCostMicros: bigint("final_cost_micros", { mode: "number" }).notNull().default(0),
    pricingSnapshot: jsonb("pricing_snapshot").$type<UsagePricingSnapshot | null>(),
    status: usageEventStatusEnum("status").notNull().default("shadow"),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").$type<UsageEventMetadata>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("usage_events_idempotency_key_uidx").on(table.idempotencyKey),
    index("usage_events_account_created_at_idx").on(table.accountId, table.createdAt),
    index("usage_events_request_id_idx").on(table.requestId),
    index("usage_events_assistant_created_at_idx").on(table.assistantId, table.createdAt),
    index("usage_events_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const usageEventsRelations = relations(usageEvents, ({ one }) => ({
  account: one(hostingAccounts, {
    fields: [usageEvents.accountId],
    references: [hostingAccounts.id],
  }),
  assistant: one(assistants, {
    fields: [usageEvents.assistantId],
    references: [assistants.id],
  }),
}));
