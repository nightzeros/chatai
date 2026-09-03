import { calculateCostMicros, type ModelPricingRow } from "@chatai/billing";
import type { EmbeddingConfig } from "@chatai/ai";
import type { UsageBillingMode } from "@chatai/database";

/**
 * Conservative embedding cost estimate for document ingest.
 * BYOK embedding contributes 0 toward the hosted reservation.
 */
export function estimateIngestEmbeddingCostMicros(input: {
  catalog: readonly ModelPricingRow[];
  embedding: EmbeddingConfig;
  billingMode: UsageBillingMode;
  approxTokens: number;
  at?: Date;
}): { estimateMicros: number } {
  if (input.billingMode !== "hosted") {
    return { estimateMicros: 0 };
  }

  const tokens = Math.max(1, Math.ceil(input.approxTokens * 1.1));
  const { costMicros } = calculateCostMicros({
    catalog: input.catalog,
    provider: input.embedding.provider ?? "openai",
    model: input.embedding.model,
    usageOperation: "embedding",
    at: input.at ?? new Date(),
    totalTokens: tokens,
  });

  return { estimateMicros: costMicros };
}
