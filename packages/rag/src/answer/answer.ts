import {
  asEmbedManyResult,
  embedMany,
  generateChat,
  type ChatConfig,
  type EmbeddingConfig,
  type ProviderUsage,
} from "@chatai/ai";
import type { MessageDebug, MessageOutcome, MessageSource } from "@chatai/database";
import type { Database } from "@chatai/database";

import { decide, FALLBACK_MESSAGE } from "./decide";

export { FALLBACK_MESSAGE };
import { applyGuardrails } from "./guardrails";
import { buildContextBlocks, buildSystemPrompt } from "./prompt";
import { sourcesFromAnswer } from "./citations";
import { expandQueries } from "./expand-query";
import { isUnsupportedContextAnswer, resolveFinalOutcome } from "./outcome";
import type { ProviderUsageRecord } from "./provider-usage";

import { resolveRagSettings, type RagSettings } from "./rag-settings";
import {
  HYBRID_CANDIDATE_LIMIT,
  mergeRetrievalLists,
  retrieveChunks,
  VECTOR_ONLY_LIMIT,
  type RetrievedChunk,
} from "./retrieve";
import { rerank, type RerankResult } from "./rerank";
import type { HallucinationMode } from "./thresholds";

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type PreparedAnswer = {
  query: string;
  retrieved: RetrievedChunk[];
  decision: ReturnType<typeof decide>;
  outcome: MessageOutcome;
  confidence: number;
  system: string;
  shouldGenerate: boolean;
  fallbackText: string;
  debug: MessageDebug;
  /** Provider sub-calls during prepare (rewrite/expand/embed/rerank). */
  providerUsages: ProviderUsageRecord[];
};

export type FinalAnswer = {
  answer: string;
  sources: MessageSource[];
  confidence: number;
  outcome: MessageOutcome;
  debug: MessageDebug;
  providerUsages: ProviderUsageRecord[];
};

async function rewriteQuery(opts: {
  message: string;
  history: ChatHistoryMessage[];
  chat: ChatConfig;
}): Promise<{ query: string; usage?: ProviderUsage }> {
  if (opts.history.length === 0) {
    return { query: opts.message };
  }

  const transcript = opts.history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${item.content}`)
    .join("\n");

  try {
    const rewritten = await generateChat({
      config: opts.chat,
      system:
        "Rewrite the latest user message as a standalone search query. Use the chat history only for context. Return only the rewritten query.",
      prompt: `${transcript}\nUser: ${opts.message}`,
    });
    return {
      query: rewritten.text || opts.message,
      usage: rewritten.usage,
    };
  } catch {
    return { query: opts.message };
  }
}

export async function prepareAnswer(opts: {
  db: Database;
  assistantId: string;
  instructions: string | null;
  mode: HallucinationMode;
  message: string;
  history?: ChatHistoryMessage[];
  embedding: EmbeddingConfig;
  chat: ChatConfig;
  ragSettings?: RagSettings | null;
  cohereApiKey?: string | null;
}): Promise<PreparedAnswer> {
  const started = Date.now();
  const rag = resolveRagSettings(opts.ragSettings);
  const providerUsages: ProviderUsageRecord[] = [];

  const rewritten = await rewriteQuery({
    message: opts.message,
    history: opts.history ?? [],
    chat: opts.chat,
  });
  const query = rewritten.query;
  if (rewritten.usage) {
    providerUsages.push({
      kind: "chat_completion",
      provider: opts.chat.provider,
      model: opts.chat.model,
      usage: rewritten.usage,
      step: "rewrite_query",
    });
  }

  const retrieveStarted = Date.now();
  let retrieved: RetrievedChunk[] = [];
  let retrievalError: string | undefined;
  let expansionMeta: { expanded: boolean; queries: string[]; alternates: string[] } | undefined;
  let rerankMeta: Pick<RerankResult, "provider" | "order"> & { enabled: boolean } | undefined;

  try {
    const expansion = await expandQueries({
      query,
      chat: opts.chat,
      enabled: rag.queryExpansion,
    });
    expansionMeta = {
      expanded: expansion.expanded,
      queries: expansion.queries,
      alternates: expansion.alternates,
    };
    if (expansion.usage) {
      providerUsages.push({
        kind: "chat_completion",
        provider: opts.chat.provider,
        model: opts.chat.model,
        usage: expansion.usage,
        step: "expand_query",
      });
    }

    const candidateLimit = rag.hybridSearch ? HYBRID_CANDIDATE_LIMIT : VECTOR_ONLY_LIMIT;
    const embedResult = asEmbedManyResult(await embedMany(expansion.queries, opts.embedding));
    providerUsages.push({
      kind: "embedding",
      provider: opts.embedding.provider,
      model: opts.embedding.model,
      usage: embedResult.usage,
      step: "query_embedding",
    });

    const retrievalLists = await Promise.all(
      expansion.queries.map(async (searchQuery, index) => {
        const queryEmbedding = embedResult.embeddings[index];
        if (!queryEmbedding) {
          throw new Error("Failed to embed query.");
        }
        return retrieveChunks({
          db: opts.db,
          assistantId: opts.assistantId,
          embedding: queryEmbedding,
          query: searchQuery,
          hybridSearch: rag.hybridSearch,
          limit: candidateLimit,
        });
      }),
    );

    retrieved =
      retrievalLists.length > 1
        ? mergeRetrievalLists(retrievalLists, candidateLimit)
        : (retrievalLists[0] ?? []);

    const rerankResult = await rerank({
      chunks: retrieved,
      query,
      chat: opts.chat,
      enabled: rag.rerank,
      cohereApiKey: opts.cohereApiKey,
    });
    retrieved = rerankResult.chunks;
    providerUsages.push(...rerankResult.providerUsages);
    rerankMeta = {
      enabled: rag.rerank,
      provider: rerankResult.provider,
      order: rerankResult.order,
    };
  } catch (error) {
    retrievalError = error instanceof Error ? error.message : "Retrieval failed.";
  }

  const bestScore = retrieved[0]?.similarity ?? 0;
  const decision = applyGuardrails(
    decide({
      mode: opts.mode,
      bestScore,
      retrievedCount: retrieved.length,
    }),
    { retrievedCount: retrieved.length, guardrails: rag.guardrails },
  );

  const promptChunks = retrieved;

  const system = buildSystemPrompt({
    instructions: opts.instructions,
    mode: opts.mode,
    decision,
    context: buildContextBlocks(promptChunks),
  });

  const outcome: MessageOutcome = retrievalError
    ? "retrieval_failure"
    : decision.action === "fallback"
      ? "fallback_no_context"
      : decision.contextSufficient
        ? "answered_with_context"
        : decision.confidence === "low"
          ? "low_confidence"
          : "answered_with_context";

  const debug: MessageDebug = {
    question: query,
    retrieval: retrieved.map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      similarity: Number(chunk.similarity.toFixed(4)),
    })),
    hybridSearch: rag.hybridSearch,
    ...(expansionMeta
      ? {
          expansion: {
            enabled: rag.queryExpansion,
            expanded: expansionMeta.expanded,
            queries: expansionMeta.queries,
            alternates: expansionMeta.alternates,
          },
        }
      : {}),
    ...(rerankMeta ? { rerank: rerankMeta } : {}),
    guardrails: rag.guardrails,
    ...(retrieved.some((chunk) => chunk.hybrid)
      ? {
          hybrid: retrieved
            .filter((chunk) => chunk.hybrid)
            .map((chunk) => ({
              chunkId: chunk.chunkId,
              vectorRank: chunk.hybrid?.vectorRank,
              keywordRank: chunk.hybrid?.keywordRank,
              rrfScore: Number((chunk.hybrid?.rrfScore ?? 0).toFixed(6)),
            })),
        }
      : {}),
    decision: {
      contextSufficient: decision.contextSufficient,
      confidence: decision.confidence,
      bestScore: Number(bestScore.toFixed(4)),
      mode: decision.mode,
      action: decision.action,
    },
    model: opts.chat.model,
    latencyMs: Date.now() - started,
    retrieveMs: Date.now() - retrieveStarted,
    ...(retrievalError ? { retrievalError } : {}),
  };

  return {
    query,
    retrieved: promptChunks,
    decision,
    outcome,
    confidence: bestScore,
    system,
    shouldGenerate: decision.action === "generate" && !retrievalError,
    fallbackText: FALLBACK_MESSAGE,
    debug,
    providerUsages,
  };
}

export function finalizeAnswer(fullText: string, prepared: PreparedAnswer): FinalAnswer {
  const answer = fullText.trim() || prepared.fallbackText;
  const outcome = resolveFinalOutcome({
    preparedOutcome: prepared.outcome,
    answer,
    fallbackText: prepared.fallbackText,
  });
  const usedFallback =
    outcome === "fallback_no_context" ||
    outcome === "retrieval_failure" ||
    isUnsupportedContextAnswer(answer, prepared.fallbackText);

  const sources = usedFallback ? [] : sourcesFromAnswer(answer, prepared.retrieved);

  return {
    answer,
    sources,
    confidence: prepared.confidence,
    outcome,
    providerUsages: prepared.providerUsages,
    debug: {
      ...prepared.debug,
      sourcesUsed: sources.map((source) => source.documentName),
    },
  };
}

export type { ProviderUsageRecord };
