import type { ChatConfig, EmbeddingConfig } from "@chatai/ai";
import { calculateCostMicros, loadSeedPricingCatalog } from "@chatai/billing";
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
      historyChars: 0,
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
      historyChars: 0,
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
      historyChars: 2_000,
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
      historyChars: 0,
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
      historyChars: 0,
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

describe("estimateChatRequestCostMicros covers the real prompt", () => {
  const at = new Date("2026-06-01T00:00:00.000Z");
  const firstTurn = {
    catalog,
    chat,
    embedding,
    billing: hostedBilling,
    message: "What are your opening hours?",
    historyChars: 0,
    queryExpansionEnabled: false,
    rerankEnabled: false,
    verifyCitationsEnabled: false,
    hasCohereKey: false,
    maxOutputTokens: 1024,
    at,
  };
  const cost = (inputTokens: number, outputTokens: number) =>
    calculateCostMicros({
      catalog,
      provider: "openai",
      model: chat.model,
      usageOperation: "chat_completion",
      at,
      inputTokens,
      outputTokens,
    }).costMicros;

  it("estimates the Scope Router on a first turn", () => {
    const result = estimateChatRequestCostMicros(firstTurn);
    expect(result.components.find((c) => c.step === "rewrite_query")?.micros).toBeGreaterThan(0);
  });

  it("is at least the cost of a first turn with a large Purpose, titles and Key Facts", () => {
    // Router ~5.7k input tokens, then an answer with 2k context + facts up to the output cap.
    const actual = cost(5_700, 200) + cost(3_400, 1024);
    expect(estimateChatRequestCostMicros(firstTurn).estimateMicros).toBeGreaterThanOrEqual(actual);
  });

  it("grows with history up to the history window", () => {
    const none = estimateChatRequestCostMicros(firstTurn).estimateMicros;
    const some = estimateChatRequestCostMicros({ ...firstTurn, historyChars: 4_000 }).estimateMicros;
    const full = estimateChatRequestCostMicros({ ...firstTurn, historyChars: 8_000 }).estimateMicros;
    const beyond = estimateChatRequestCostMicros({ ...firstTurn, historyChars: 80_000 }).estimateMicros;
    expect(some).toBeGreaterThan(none);
    expect(full).toBeGreaterThan(some);
    expect(beyond).toBe(full);
  });

  it("covers a second retrieval pass for partial turns", () => {
    const result = estimateChatRequestCostMicros({ ...firstTurn, rerankEnabled: true });
    const rerank = result.components.find((c) => c.step === "rerank_llm")!.micros;
    expect(rerank).toBe(cost(2000, 200) * 2);
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
