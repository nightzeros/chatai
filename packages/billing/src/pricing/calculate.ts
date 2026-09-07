import { applyRateMicros, findEffectiveRate } from "./registry";
import type {
  ModelPricingOperation,
  ModelPricingRow,
  UsageOperation,
  UsagePricingRateSnapshot,
  UsagePricingSnapshot,
} from "./types";

export type CalculateCostInput = {
  catalog: readonly ModelPricingRow[];
  provider: string;
  model?: string | null;
  usageOperation: UsageOperation;
  at?: Date;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** Token total for embeddings when input/output split is unavailable. */
  totalTokens?: number;
  /** Non-token units (e.g. Cohere rerank request count). */
  units?: number;
};

export type CalculateCostResult = {
  costMicros: number;
  pricingSnapshot: UsagePricingSnapshot;
};

function pricingOperationsFor(usageOperation: UsageOperation): ModelPricingOperation[] {
  switch (usageOperation) {
    case "chat_completion":
      return ["chat_input", "chat_output", "chat_cached_input"];
    case "embedding":
      return ["embedding"];
    case "rerank":
      return ["rerank"];
    default: {
      const _exhaustive: never = usageOperation;
      return _exhaustive;
    }
  }
}

function quantityFor(
  pricingOperation: ModelPricingOperation,
  input: CalculateCostInput,
): number {
  switch (pricingOperation) {
    case "chat_input":
      return input.inputTokens ?? 0;
    case "chat_output":
      return input.outputTokens ?? 0;
    case "chat_cached_input":
      return input.cachedInputTokens ?? 0;
    case "embedding":
      return input.totalTokens ?? input.inputTokens ?? 0;
    case "rerank":
      return input.units ?? 1;
    default: {
      const _exhaustive: never = pricingOperation;
      return _exhaustive;
    }
  }
}

/**
 * Estimate provider cost in micro-dollars from token/unit counts and a pricing catalog.
 * Missing rates contribute 0 and set `unknownPricing` when no rate matched for a needed component
 * that had a non-zero quantity (or when every needed rate is missing).
 */
export function calculateCostMicros(input: CalculateCostInput): CalculateCostResult {
  const at = input.at ?? new Date();
  const rates: UsagePricingRateSnapshot[] = [];
  let costMicros = 0;
  let matchedAny = false;
  let missingNeededRate = false;

  for (const pricingOperation of pricingOperationsFor(input.usageOperation)) {
    const quantity = quantityFor(pricingOperation, input);
    // Skip optional cached_input when unused.
    if (pricingOperation === "chat_cached_input" && quantity <= 0) {
      continue;
    }

    const row = findEffectiveRate(input.catalog, {
      provider: input.provider,
      model: input.model,
      operation: pricingOperation,
      at,
    });

    if (!row) {
      if (quantity > 0) {
        missingNeededRate = true;
      }
      continue;
    }

    matchedAny = true;
    rates.push({
      pricingOperation,
      priceMicrosPerUnit: row.priceMicrosPerUnit,
      unit: row.unit,
      effectiveFrom: toIso(row.effectiveFrom),
    });
    costMicros += applyRateMicros(quantity, row.priceMicrosPerUnit, row.unit);
  }

  const unknownPricing = !matchedAny || missingNeededRate;

  return {
    costMicros,
    pricingSnapshot: {
      provider: input.provider,
      model: input.model ?? null,
      usageOperation: input.usageOperation,
      rates,
      ...(unknownPricing ? { unknownPricing: true } : {}),
    },
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
