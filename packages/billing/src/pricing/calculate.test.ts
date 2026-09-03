import { describe, expect, it } from "vitest";

import { calculateCostMicros } from "./calculate";
import { applyRateMicros, findEffectiveRate } from "./registry";
import { loadSeedPricingCatalog } from "./seed";
import type { ModelPricingRow } from "./types";

const catalog = loadSeedPricingCatalog();

describe("applyRateMicros", () => {
  it("computes per-million-token costs with integer math", () => {
    // 1_000 tokens at $0.15 / 1M = 150 micros
    expect(applyRateMicros(1_000, 150_000, "per_million_tokens")).toBe(150);
  });

  it("computes per-request costs", () => {
    expect(applyRateMicros(3, 2_000, "per_request")).toBe(6_000);
  });

  it("computes per-1k-token costs", () => {
    expect(applyRateMicros(500, 10_000, "per_1k_tokens")).toBe(5_000);
  });

  it("returns 0 for non-positive quantities", () => {
    expect(applyRateMicros(0, 150_000, "per_million_tokens")).toBe(0);
    expect(applyRateMicros(-1, 150_000, "per_million_tokens")).toBe(0);
  });
});

describe("findEffectiveRate", () => {
  it("prefers an exact model match over provider wildcard", () => {
    const row = findEffectiveRate(catalog, {
      provider: "openai",
      model: "gpt-4o-mini",
      operation: "chat_input",
      at: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(row?.model).toBe("gpt-4o-mini");
    expect(row?.priceMicrosPerUnit).toBe(150_000);
  });

  it("falls back to provider wildcard when model is unknown", () => {
    const row = findEffectiveRate(catalog, {
      provider: "openai",
      model: "gpt-unknown-future",
      operation: "chat_output",
      at: new Date("2026-03-01T00:00:00.000Z"),
    });
    expect(row?.model).toBe("*");
    expect(row?.priceMicrosPerUnit).toBe(600_000);
  });

  it("ignores rates that are not yet effective", () => {
    const futureCatalog: ModelPricingRow[] = [
      {
        id: "future",
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat_input",
        priceMicrosPerUnit: 999,
        unit: "per_million_tokens",
        effectiveFrom: "2027-01-01T00:00:00.000Z",
      },
    ];
    expect(
      findEffectiveRate(futureCatalog, {
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat_input",
        at: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("respects effectiveTo windows for historical pricing", () => {
    const versioned: ModelPricingRow[] = [
      {
        id: "old",
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat_input",
        priceMicrosPerUnit: 100_000,
        unit: "per_million_tokens",
        effectiveFrom: "2025-01-01T00:00:00.000Z",
        effectiveTo: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "new",
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat_input",
        priceMicrosPerUnit: 150_000,
        unit: "per_million_tokens",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
    ];

    expect(
      findEffectiveRate(versioned, {
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat_input",
        at: new Date("2025-06-01T00:00:00.000Z"),
      })?.priceMicrosPerUnit,
    ).toBe(100_000);

    expect(
      findEffectiveRate(versioned, {
        provider: "openai",
        model: "gpt-4o-mini",
        operation: "chat_input",
        at: new Date("2026-06-01T00:00:00.000Z"),
      })?.priceMicrosPerUnit,
    ).toBe(150_000);
  });
});

describe("calculateCostMicros", () => {
  it("sums chat input + output (+ cached) rates into a snapshot", () => {
    const result = calculateCostMicros({
      catalog,
      provider: "openai",
      model: "gpt-4o-mini",
      usageOperation: "chat_completion",
      at: new Date("2026-03-01T00:00:00.000Z"),
      inputTokens: 1_000,
      outputTokens: 500,
      cachedInputTokens: 200,
    });

    // input: 1000 * 150000 / 1e6 = 150
    // output: 500 * 600000 / 1e6 = 300
    // cached: 200 * 75000 / 1e6 = 15
    expect(result.costMicros).toBe(465);
    expect(result.pricingSnapshot.rates).toHaveLength(3);
    expect(result.pricingSnapshot.unknownPricing).toBeUndefined();
    expect(result.pricingSnapshot.usageOperation).toBe("chat_completion");
  });

  it("prices embeddings by total tokens", () => {
    const result = calculateCostMicros({
      catalog,
      provider: "openai",
      model: "text-embedding-3-small",
      usageOperation: "embedding",
      totalTokens: 10_000,
      at: new Date("2026-03-01T00:00:00.000Z"),
    });

    // 10000 * 20000 / 1e6 = 200
    expect(result.costMicros).toBe(200);
    expect(result.pricingSnapshot.rates[0]?.pricingOperation).toBe("embedding");
  });

  it("prices rerank by request units", () => {
    const result = calculateCostMicros({
      catalog,
      provider: "cohere",
      model: "rerank-v3.5",
      usageOperation: "rerank",
      units: 2,
      at: new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(result.costMicros).toBe(4_000);
  });

  it("marks unknownPricing when a needed rate is missing", () => {
    const result = calculateCostMicros({
      catalog: [],
      provider: "unknown-provider",
      model: "x",
      usageOperation: "chat_completion",
      inputTokens: 100,
      outputTokens: 50,
    });

    expect(result.costMicros).toBe(0);
    expect(result.pricingSnapshot.unknownPricing).toBe(true);
    expect(result.pricingSnapshot.rates).toEqual([]);
  });

  it("keeps historical cost stable when catalog prices change later", () => {
    const at = new Date("2026-02-01T00:00:00.000Z");
    const first = calculateCostMicros({
      catalog,
      provider: "openai",
      model: "gpt-4o-mini",
      usageOperation: "chat_completion",
      inputTokens: 1_000,
      outputTokens: 0,
      at,
    });

    const raised: ModelPricingRow[] = catalog.map((row) =>
      row.model === "gpt-4o-mini" && row.operation === "chat_input"
        ? { ...row, priceMicrosPerUnit: 999_000_000 }
        : row,
    );

    // Snapshot from first calculation remains the historical truth for the event.
    expect(first.pricingSnapshot.rates[0]?.priceMicrosPerUnit).toBe(150_000);

    const later = calculateCostMicros({
      catalog: raised,
      provider: "openai",
      model: "gpt-4o-mini",
      usageOperation: "chat_completion",
      inputTokens: 1_000,
      outputTokens: 0,
      at,
    });
    expect(later.costMicros).not.toBe(first.costMicros);
  });
});
