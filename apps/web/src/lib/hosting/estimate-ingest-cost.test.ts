import type { EmbeddingConfig } from "@chatai/ai";
import { loadSeedPricingCatalog } from "@chatai/billing";
import { describe, expect, it } from "vitest";

import { estimateIngestEmbeddingCostMicros } from "./estimate-ingest-cost";

const catalog = loadSeedPricingCatalog();
const embedding = {
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "test",
  baseURL: "https://api.openai.com/v1",
  dimensions: 1536,
} satisfies EmbeddingConfig;

describe("estimateIngestEmbeddingCostMicros", () => {
  it("estimates hosted embedding cost with a 10% cushion", () => {
    const result = estimateIngestEmbeddingCostMicros({
      catalog,
      embedding,
      billingMode: "hosted",
      approxTokens: 1_000,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result.estimateMicros).toBeGreaterThan(0);
  });

  it("returns zero for BYOK embedding", () => {
    const result = estimateIngestEmbeddingCostMicros({
      catalog,
      embedding,
      billingMode: "byok",
      approxTokens: 50_000,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result.estimateMicros).toBe(0);
  });
});
