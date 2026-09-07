import { calculateCostMicros, type ModelPricingRow } from "@chatai/billing";
import type { ChatConfig, EmbeddingConfig } from "@chatai/ai";
import type { UsageBillingMode } from "@chatai/database";

import type { AssistantBillingModes } from "@/lib/ai-config";

export type ChatCostEstimateInput = {
  catalog: readonly ModelPricingRow[];
  chat: ChatConfig;
  embedding: EmbeddingConfig;
  billing: AssistantBillingModes;
  message: string;
  hasHistory: boolean;
  queryExpansionEnabled: boolean;
  rerankEnabled: boolean;
  verifyCitationsEnabled: boolean;
  hasCohereKey: boolean;
  maxOutputTokens: number;
  at?: Date;
};

export type ChatCostEstimate = {
  estimateMicros: number;
  /** Breakdown for debugging / reservation event metadata. */
  components: Array<{ step: string; micros: number; billingMode: UsageBillingMode }>;
};

function approxTokensFromChars(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function chatCost(
  catalog: readonly ModelPricingRow[],
  chat: ChatConfig,
  inputTokens: number,
  outputTokens: number,
  at: Date,
): number {
  return calculateCostMicros({
    catalog,
    provider: chat.provider ?? "openai",
    model: chat.model,
    usageOperation: "chat_completion",
    at,
    inputTokens,
    outputTokens,
  }).costMicros;
}

/**
 * Conservative pre-request cost ceiling for a hosted chat turn.
 * BYOK components contribute 0 toward the NightZeros reservation.
 */
export function estimateChatRequestCostMicros(input: ChatCostEstimateInput): ChatCostEstimate {
  const at = input.at ?? new Date();
  const components: ChatCostEstimate["components"] = [];
  const messageTokens = approxTokensFromChars(input.message);
  const maxOut = Math.max(1, input.maxOutputTokens);

  const add = (step: string, micros: number, billingMode: UsageBillingMode) => {
    const hostedMicros = billingMode === "hosted" ? micros : 0;
    components.push({ step, micros: hostedMicros, billingMode });
  };

  if (input.hasHistory) {
    add(
      "rewrite_query",
      chatCost(input.catalog, input.chat, 500, 100, at),
      input.billing.chat,
    );
  }

  const queryCount = input.queryExpansionEnabled ? 3 : 1;
  if (input.queryExpansionEnabled) {
    add(
      "expand_query",
      chatCost(input.catalog, input.chat, 300, 100, at),
      input.billing.chat,
    );
  }

  const embedTokens = messageTokens * queryCount;
  const embedMicros = calculateCostMicros({
    catalog: input.catalog,
    provider: input.embedding.provider ?? "openai",
    model: input.embedding.model,
    usageOperation: "embedding",
    at,
    totalTokens: embedTokens,
  }).costMicros;
  add("query_embedding", embedMicros, input.billing.embedding);

  if (input.rerankEnabled) {
    if (input.hasCohereKey) {
      const rerankMicros = calculateCostMicros({
        catalog: input.catalog,
        provider: "cohere",
        model: "*",
        usageOperation: "rerank",
        at,
        units: 1,
      }).costMicros;
      add("rerank_cohere", rerankMicros, input.billing.rerank);
    } else {
      add(
        "rerank_llm",
        chatCost(input.catalog, input.chat, 2000, 200, at),
        input.billing.chat,
      );
    }
  }

  // Answer generation: assume up to ~2k context tokens + message + max output.
  const answerInput = 2000 + messageTokens;
  const answerCalls = input.verifyCitationsEnabled ? 4 : 1;
  add(
    input.verifyCitationsEnabled ? "verified_answer" : "stream_answer",
    chatCost(input.catalog, input.chat, answerInput, maxOut, at) * answerCalls,
    input.billing.chat,
  );

  const estimateMicros = components.reduce((sum, item) => sum + item.micros, 0);
  return { estimateMicros, components };
}

/** Sum hosted (non-BYOK) final costs from recorded provider usages. */
export function sumHostedActualCostMicros(
  records: Array<{ kind: "chat_completion" | "embedding" | "rerank"; costMicros: number; billingMode: UsageBillingMode }>,
): number {
  return records
    .filter((row) => row.billingMode === "hosted")
    .reduce((sum, row) => sum + Math.max(0, row.costMicros), 0);
}
