export const MODEL_PRICING_OPERATIONS = [
  "chat_input",
  "chat_output",
  "chat_cached_input",
  "embedding",
  "rerank",
] as const;
export type ModelPricingOperation = (typeof MODEL_PRICING_OPERATIONS)[number];

export const MODEL_PRICING_UNITS = [
  "per_million_tokens",
  "per_request",
  "per_1k_tokens",
] as const;
export type ModelPricingUnit = (typeof MODEL_PRICING_UNITS)[number];

export const USAGE_OPERATIONS = ["chat_completion", "embedding", "rerank"] as const;
export type UsageOperation = (typeof USAGE_OPERATIONS)[number];

/** Catalog row used for live price lookup (DB or seed). */
export type ModelPricingRow = {
  id: string;
  provider: string;
  model: string;
  operation: ModelPricingOperation;
  priceMicrosPerUnit: number;
  unit: ModelPricingUnit;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
};

export type UsagePricingRateSnapshot = {
  pricingOperation: ModelPricingOperation;
  priceMicrosPerUnit: number;
  unit: ModelPricingUnit;
  effectiveFrom?: string;
};

export type UsagePricingSnapshot = {
  provider: string;
  model?: string | null;
  usageOperation: UsageOperation;
  rates: UsagePricingRateSnapshot[];
  unknownPricing?: boolean;
};
