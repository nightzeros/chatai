import { describe, expect, it } from "vitest";

import { loadSeedPricingCatalog } from "./seed";

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
