import { describe, expect, it } from "vitest";

import { loadSeedPricingCatalog, mergeSeedPricing } from "./seed";
import type { ModelPricingRow } from "./types";

describe("loadSeedPricingCatalog", () => {
  it("loads a non-empty seed catalog with required fields", () => {
    const catalog = loadSeedPricingCatalog();
    expect(catalog.length).toBeGreaterThan(10);
    expect(catalog.every((row) => row.id && row.provider && row.operation)).toBe(true);
    expect(catalog.some((row) => row.provider === "openai" && row.model === "gpt-4o-mini")).toBe(
      true,
    );
    expect(catalog.some((row) => row.provider === "cohere" && row.operation === "rerank")).toBe(
      true,
    );
  });
});

describe("mergeSeedPricing", () => {
  const dbRow = (overrides: Partial<ModelPricingRow>): ModelPricingRow => ({
    id: "db",
    provider: "openai",
    model: "gpt-4o-mini",
    operation: "chat_input",
    priceMicrosPerUnit: 1,
    unit: "per_million_tokens",
    effectiveFrom: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  it("adds seed Voice rates missing from the database", () => {
    const merged = mergeSeedPricing([dbRow({})]);
    expect(merged.some((r) => r.operation === "voice_realtime" && r.model === "gpt-live-1")).toBe(true);
  });

  it("never overrides a database Voice rate", () => {
    const custom = dbRow({
      id: "custom",
      model: "gpt-live-1",
      operation: "voice_realtime",
      priceMicrosPerUnit: 99_000,
      unit: "per_minute",
    });
    const merged = mergeSeedPricing([custom]);
    const live = merged.filter((r) => r.operation === "voice_realtime" && r.model === "gpt-live-1");
    expect(live).toEqual([custom]);
  });

  it("does not merge text-model seed rates (text billing unchanged)", () => {
    const merged = mergeSeedPricing([]);
    expect(merged.every((r) => r.operation === "voice_realtime")).toBe(true);
  });
});
