import { calculateCostMicros, type ModelPricingRow } from "@chatai/billing";
import type { ChatConfig, EmbeddingConfig } from "@chatai/ai";
import type { UsageBillingMode } from "@chatai/database";
import { CONVERSATION_HISTORY_WINDOW } from "@chatai/rag/answer";

import type { AssistantBillingModes } from "@/lib/ai-config";

export type ChatCostEstimateInput = {
  catalog: readonly ModelPricingRow[];
  chat: ChatConfig;
  embedding: EmbeddingConfig;
  billing: AssistantBillingModes;
  message: string;
  /** Total characters of the conversation history sent with this turn. */
  historyChars: number;
  queryExpansionEnabled: boolean;
  rerankEnabled: boolean;
  verifyCitationsEnabled: boolean;
  hasCohereKey: boolean;
  maxOutputTokens: number;
  /** Output scope check may run (one small call on risk-gated turns). */
  outputScopeCheck?: boolean;
  at?: Date;
};

export type ChatCostEstimate = {
  estimateMicros: number;
  /** Breakdown for debugging / reservation event metadata. */
  components: Array<{ step: string; micros: number; billingMode: UsageBillingMode }>;
};

/** Scope Router prompt ceiling: planner rules, Purpose, Knowledge titles and Key Fact hints. */
const ROUTER_PROMPT_TOKENS = 6_000;
const ROUTER_OUTPUT_TOKENS = 300;
/** Purpose and Key Facts added to the answer prompt. */
const PROFILE_CONTEXT_TOKENS = 1_500;
const RETRIEVED_CONTEXT_TOKENS = 2_000;
/** Partial turns retrieve a second time for the authorized part of the request. */
const RETRIEVAL_PASSES = 2;

function approxTokensFromChars(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function historyTokens(historyChars: number): number {
  const chars = Math.min(Math.max(0, historyChars), CONVERSATION_HISTORY_WINDOW.maxTotalChars);
  return chars > 0 ? Math.ceil(chars / 4) : 0;
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

  const priorTokens = historyTokens(input.historyChars);

  add(
    "rewrite_query",
    chatCost(input.catalog, input.chat, ROUTER_PROMPT_TOKENS + priorTokens + messageTokens, ROUTER_OUTPUT_TOKENS, at),
    input.billing.chat,
  );

  const queryCount = (input.queryExpansionEnabled ? 3 : 1) * RETRIEVAL_PASSES;
  if (input.queryExpansionEnabled) {
    add(
      "expand_query",
      chatCost(input.catalog, input.chat, 300, 100, at) * RETRIEVAL_PASSES,
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
        units: RETRIEVAL_PASSES,
      }).costMicros;
      add("rerank_cohere", rerankMicros, input.billing.rerank);
    } else {
      add(
        "rerank_llm",
        chatCost(input.catalog, input.chat, 2000, 200, at) * RETRIEVAL_PASSES,
        input.billing.chat,
      );
    }
  }

  // Answer generation is capped at `maxOutputTokens` for hosted chat.
  const answerInput = RETRIEVED_CONTEXT_TOKENS + PROFILE_CONTEXT_TOKENS + priorTokens + messageTokens;
  const answerCalls = input.verifyCitationsEnabled ? 4 : 1;
  add(
    input.verifyCitationsEnabled ? "verified_answer" : "stream_answer",
    chatCost(input.catalog, input.chat, answerInput, maxOut, at) * answerCalls,
    input.billing.chat,
  );

  if (input.outputScopeCheck) {
    add("output_scope_check", chatCost(input.catalog, input.chat, 1000, 20, at), input.billing.chat);
  }

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
