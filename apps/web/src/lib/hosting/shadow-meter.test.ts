import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const insert = vi.fn(() => ({ values: insertValues }));
const selectFrom = vi.fn(() => ({
  // unused — catalog injected in tests
}));
const select = vi.fn(() => ({ from: selectFrom }));
const db = vi.fn(() => ({ insert, select }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/ids", () => ({
  createId: () => "usage-event-1",
}));

const envState = {
  HOSTED_USAGE_ENFORCEMENT: "shadow" as "shadow" | "enforce" | "off",
};

vi.mock("@/lib/env", () => ({
  env: envState,
}));

vi.mock("./pricing-catalog", () => ({
  loadModelPricingCatalog: vi.fn(async () => []),
}));

describe("recordShadowUsages", () => {
  beforeEach(() => {
    envState.HOSTED_USAGE_ENFORCEMENT = "shadow";
    insertValues.mockReset();
    insertValues.mockResolvedValue(undefined);
  });

  it("writes one shadow event per provider usage record with cost snapshot", async () => {
    const { loadSeedPricingCatalog } = await import("@chatai/billing");
    const { recordShadowUsages } = await import("./shadow-meter");

    const written = await recordShadowUsages({
      accountId: "acct-1",
      assistantId: "asst-1",
      requestId: "req-1",
      source: "widget",
      visitorId: "visitor-abc",
      catalog: loadSeedPricingCatalog(),
      records: [
        {
          kind: "chat_completion",
          provider: "openai",
          model: "gpt-4o-mini",
          usage: {
            inputTokens: 1_000,
            outputTokens: 500,
            cachedInputTokens: 0,
            totalTokens: 1_500,
          },
          step: "stream_answer",
        },
      ],
      billingModeFor: () => "hosted",
    });

    expect(written).toBe(1);
    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "usage-event-1",
        accountId: "acct-1",
        assistantId: "asst-1",
        requestId: "req-1",
        operation: "chat_completion",
        provider: "openai",
        model: "gpt-4o-mini",
        billingMode: "hosted",
        status: "shadow",
        inputTokens: 1_000,
        outputTokens: 500,
        finalCostMicros: 450, // 150 + 300 from seed rates
        metadata: expect.objectContaining({
          source: "widget",
          step: "stream_answer",
          visitorIdHash: expect.any(String),
        }),
      }),
    ]);
  });

  it("stores byok provider cost in metadata and zeroes finalCostMicros", async () => {
    const { loadSeedPricingCatalog } = await import("@chatai/billing");
    const { recordShadowUsages } = await import("./shadow-meter");

    await recordShadowUsages({
      accountId: "acct-1",
      requestId: "req-2",
      source: "api",
      catalog: loadSeedPricingCatalog(),
      records: [
        {
          kind: "embedding",
          provider: "openai",
          model: "text-embedding-3-small",
          usage: {
            inputTokens: 10_000,
            outputTokens: 0,
            cachedInputTokens: 0,
            totalTokens: 10_000,
          },
          step: "document_ingest",
        },
      ],
      billingModeFor: () => "byok",
    });

    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        billingMode: "byok",
        finalCostMicros: 0,
        metadata: expect.objectContaining({
          byokProviderCostMicros: 200,
        }),
      }),
    ]);
  });

  it("writes status=completed when enforcement is on", async () => {
    envState.HOSTED_USAGE_ENFORCEMENT = "enforce";
    const { loadSeedPricingCatalog } = await import("@chatai/billing");
    const { recordShadowUsages } = await import("./shadow-meter");

    await recordShadowUsages({
      accountId: "acct-1",
      requestId: "req-enforce",
      catalog: loadSeedPricingCatalog(),
      records: [
        {
          kind: "chat_completion",
          provider: "openai",
          model: "gpt-4o-mini",
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            cachedInputTokens: 0,
            totalTokens: 150,
          },
        },
      ],
      billingModeFor: () => "hosted",
    });

    expect(insertValues).toHaveBeenCalledWith([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("swallows insert failures", async () => {
    insertValues.mockRejectedValueOnce(new Error("db down"));
    const { loadSeedPricingCatalog } = await import("@chatai/billing");
    const { recordShadowUsages } = await import("./shadow-meter");

    await expect(
      recordShadowUsages({
        accountId: "acct-1",
        requestId: "req-3",
        catalog: loadSeedPricingCatalog(),
        records: [
          {
            kind: "rerank",
            provider: "cohere",
            model: "rerank-english-v3.0",
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              totalTokens: 0,
            },
          },
        ],
        billingModeFor: () => "hosted",
      }),
    ).resolves.toBe(0);
  });
});
