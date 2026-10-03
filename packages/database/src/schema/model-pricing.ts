import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const MODEL_PRICING_OPERATIONS = [
  "chat_input",
  "chat_output",
  "chat_cached_input",
  "embedding",
  "rerank",
  "voice_realtime",
] as const;
export type ModelPricingOperation = (typeof MODEL_PRICING_OPERATIONS)[number];

export const modelPricingOperationEnum = pgEnum("model_pricing_operation", [
  ...MODEL_PRICING_OPERATIONS,
]);

/** `per_minute`: a per-minute price applied to a quantity in seconds (per-second billing). */
export const MODEL_PRICING_UNITS = [
  "per_million_tokens",
  "per_request",
  "per_1k_tokens",
  "per_minute",
] as const;
export type ModelPricingUnit = (typeof MODEL_PRICING_UNITS)[number];

export const modelPricingUnitEnum = pgEnum("model_pricing_unit", [...MODEL_PRICING_UNITS]);

/**
 * Versioned provider/model rates. Historical usage retains cost via
 * `usage_events.pricing_snapshot`; live lookups use effective_from / effective_to.
 * Use model = `*` for provider-wide default rates.
 */
export const modelPricing = pgTable(
  "model_pricing",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    /** Exact model id, or `*` for provider default. */
    model: text("model").notNull(),
    operation: modelPricingOperationEnum("operation").notNull(),
    priceMicrosPerUnit: bigint("price_micros_per_unit", { mode: "number" }).notNull(),
    unit: modelPricingUnitEnum("unit").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("model_pricing_lookup_idx").on(
      table.provider,
      table.model,
      table.operation,
      table.effectiveFrom,
    ),
  ],
);
