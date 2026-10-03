import type { ChatConfig, EmbeddingConfig } from "@chatai/ai";
import { loadSeedPricingCatalog } from "@chatai/billing";
import { describe, expect, it } from "vitest";

import { estimateChatRequestCostMicros, sumHostedActualCostMicros } from "./estimate-chat-cost";

const catalog = loadSeedPricingCatalog();

const hostedBilling = {
  chat: "hosted" as const,
  embedding: "hosted" as const,
  rerank: "hosted" as const,
};

const byokBilling = {
  chat: "byok" as const,
  embedding: "byok" as const,
  rerank: "hosted" as const,
};

const chat = {
  provider: "openai",
  model: "gpt-4o-mini",
  apiKey: "test",
  baseURL: "https://api.openai.com/v1",
} satisfies ChatConfig;

const embedding = {
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "test",
  baseURL: "https://api.openai.com/v1",
  dimensions: 1536,
} satisfies EmbeddingConfig;

describe("estimateChatRequestCostMicros", () => {
  it("returns a positive hosted estimate for a simple stream turn", () => {
    const result = estimateChatRequestCostMicros({
      catalog,
      chat,
      embedding,
      billing: hostedBilling,
      message: "Hello world",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
      maxOutputTokens: 4096,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });

    expect(result.estimateMicros).toBeGreaterThan(0);
    expect(result.components.every((c) => c.billingMode === "hosted")).toBe(true);
    expect(result.components.some((c) => c.step === "stream_answer")).toBe(true);
  });

  it("adds one small output scope check component when the check is enabled", () => {
    const base = {
      catalog,
      chat,
      embedding,
      billing: hostedBilling,
      message: "Hello world",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
      maxOutputTokens: 4096,
      at: new Date("2026-06-01T00:00:00.000Z"),
    };
    const without = estimateChatRequestCostMicros(base);
    const withCheck = estimateChatRequestCostMicros({ ...base, outputScopeCheck: true });
    const check = withCheck.components.find((c) => c.step === "output_scope_check");
    expect(without.components.some((c) => c.step === "output_scope_check")).toBe(false);
    expect(check?.micros).toBeGreaterThan(0);
    expect(withCheck.estimateMicros).toBe(without.estimateMicros + check!.micros);
  });

  it("charges 0 for BYOK chat/embedding while still estimating hosted rerank", () => {
    const result = estimateChatRequestCostMicros({
      catalog,
      chat,
      embedding,
      billing: byokBilling,
      message: "Hello",
      hasHistory: true,
      queryExpansionEnabled: true,
      rerankEnabled: true,
      verifyCitationsEnabled: false,
      hasCohereKey: true,
      maxOutputTokens: 1024,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });

    const byokSteps = result.components.filter((c) => c.billingMode === "byok");
    const hostedSteps = result.components.filter((c) => c.billingMode === "hosted");

    expect(byokSteps.every((c) => c.micros === 0)).toBe(true);
    expect(hostedSteps.some((c) => c.step === "rerank_cohere" && c.micros > 0)).toBe(true);
    expect(result.estimateMicros).toBe(
      hostedSteps.reduce((sum, c) => sum + c.micros, 0),
    );
  });

  it("scales answer cost when verifyCitations runs multiple chat calls", () => {
    const base = estimateChatRequestCostMicros({
      catalog,
      chat,
      embedding,
      billing: hostedBilling,
      message: "q",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
      maxOutputTokens: 100,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });

    const verified = estimateChatRequestCostMicros({
      catalog,
      chat,
      embedding,
      billing: hostedBilling,
      message: "q",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: true,
      hasCohereKey: false,
      maxOutputTokens: 100,
      at: new Date("2026-06-01T00:00:00.000Z"),
    });

    const baseAnswer = base.components.find((c) => c.step === "stream_answer")!.micros;
    const verifiedAnswer = verified.components.find((c) => c.step === "verified_answer")!.micros;
    expect(verifiedAnswer).toBe(baseAnswer * 4);
  });
});

describe("sumHostedActualCostMicros", () => {
  it("sums only hosted rows", () => {
    expect(
      sumHostedActualCostMicros([
        { kind: "chat_completion", costMicros: 100, billingMode: "hosted" },
        { kind: "embedding", costMicros: 50, billingMode: "byok" },
        { kind: "rerank", costMicros: 25, billingMode: "hosted" },
      ]),
    ).toBe(125);
  });
});
