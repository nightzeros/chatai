import type { ChatConfig, EmbeddingConfig } from "@chatai/ai";
import { asEmbedManyResult, embedMany } from "@chatai/ai";
import type { Database } from "@chatai/database";

import type { ProviderUsageListener, ProviderUsageRecord } from "../answer/provider-usage";
import { expandQueries } from "../answer/expand-query";
import { resolveRagSettings, type RagSettings } from "../answer/rag-settings";
import { rerank } from "../answer/rerank";
import {
  HYBRID_CANDIDATE_LIMIT,
  VECTOR_ONLY_LIMIT,
  mergeRetrievalLists,
  retrieveChunks,
  type RetrievedChunk,
} from "../answer/retrieve";

export type KnowledgePassage = {
  /** 1-based citation id for this turn. */
  id: string;
  documentId: string;
  chunkId: string;
  title: string | null;
  text: string;
  /** Retrieval relevance only — not claim support. */
  score: number;
  contentHash?: string | null;
};

export type SearchKnowledgeResult = {
  passages: KnowledgePassage[];
  meta: {
    emptyReason?: string;
    retrieveMs: number;
  };
  usages: ProviderUsageRecord[];
  chunks: RetrievedChunk[];
};

const MAX_TOP_K = 12;

/**
 * Passages-only retrieval tool body.
 * Must not generate answers, invitations, open gates, write history, or settle usage.
 */
export async function executeSearchKnowledge(opts: {
  db: Database;
  assistantId: string;
  query: string;
  topK?: number;
  embedding: EmbeddingConfig;
  chat: ChatConfig;
  ragSettings?: RagSettings | null;
  cohereApiKey?: string | null;
  onUsage?: ProviderUsageListener;
  /** Abort in-flight work when the turn is cancelled. */
  abortSignal?: AbortSignal;
}): Promise<SearchKnowledgeResult> {
  if (opts.abortSignal?.aborted) {
    return {
      passages: [],
      meta: { emptyReason: "aborted", retrieveMs: 0 },
      usages: [],
      chunks: [],
    };
  }

  const query = opts.query.trim().slice(0, 2000);
  if (!query) {
    return {
      passages: [],
      meta: { emptyReason: "empty_query", retrieveMs: 0 },
      usages: [],
      chunks: [],
    };
  }

  const rag = resolveRagSettings(opts.ragSettings);
  const started = Date.now();
  const usages: ProviderUsageRecord[] = [];
  const topK = Math.min(Math.max(opts.topK ?? 8, 1), MAX_TOP_K);

  try {
    const expansion = await expandQueries({
      query,
      chat: opts.chat,
      enabled: rag.queryExpansion,
    });
    if (expansion.usage) {
      const record: ProviderUsageRecord = {
        kind: "chat_completion",
        provider: opts.chat.provider,
        model: opts.chat.model,
        usage: expansion.usage,
        step: "search_knowledge_expand",
        eventId: `search_expand:${started}:${query.slice(0, 40)}`,
      };
      usages.push(record);
      opts.onUsage?.(record);
    }

    if (opts.abortSignal?.aborted) {
      return {
        passages: [],
        meta: { emptyReason: "aborted", retrieveMs: Date.now() - started },
        usages,
        chunks: [],
      };
    }

    const candidateLimit = rag.hybridSearch ? HYBRID_CANDIDATE_LIMIT : VECTOR_ONLY_LIMIT;
    const embedResult = asEmbedManyResult(await embedMany(expansion.queries, opts.embedding));
    const embedRecord: ProviderUsageRecord = {
      kind: "embedding",
      provider: opts.embedding.provider,
      model: opts.embedding.model,
      usage: embedResult.usage,
      step: "search_knowledge_embed",
      eventId: `search_embed:${started}:${query.slice(0, 40)}`,
    };
    usages.push(embedRecord);
    opts.onUsage?.(embedRecord);

    const retrievalLists = await Promise.all(
      expansion.queries.map(async (searchQuery, index) => {
        const queryEmbedding = embedResult.embeddings[index];
        if (!queryEmbedding) throw new Error("Failed to embed query.");
        // retrieveChunks scopes by assistantId (tenant isolation).
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

    const merged =
      retrievalLists.length > 1
        ? mergeRetrievalLists(retrievalLists, candidateLimit)
        : (retrievalLists[0] ?? []);

    const rerankResult = await rerank({
      chunks: merged,
      query,
      chat: opts.chat,
      enabled: rag.rerank,
      cohereApiKey: opts.cohereApiKey,
    });
    for (const usage of rerankResult.providerUsages) {
      const record: ProviderUsageRecord = {
        ...usage,
        step: usage.step ?? "search_knowledge_rerank",
        eventId: usage.eventId ?? `search_rerank:${started}:${usages.length}`,
      };
      usages.push(record);
      opts.onUsage?.(record);
    }

    const chunks = rerankResult.chunks.slice(0, topK);
    const passages: KnowledgePassage[] = chunks.map((chunk, index) => ({
      id: String(index + 1),
      documentId: chunk.documentId,
      chunkId: chunk.chunkId,
      title: chunk.documentName ?? null,
      text: (chunk.parentContent ?? chunk.content).slice(0, 2000),
      score: chunk.similarity,
    }));

    return {
      passages,
      meta: {
        retrieveMs: Date.now() - started,
        ...(passages.length === 0 ? { emptyReason: "no_matches" } : {}),
      },
      usages,
      chunks,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retrieval failed.";
    return {
      passages: [],
      meta: { emptyReason: message, retrieveMs: Date.now() - started },
      usages,
      chunks: [],
    };
  }
}

export function searchKnowledgeToolDefinition(opts: {
  db: Database;
  assistantId: string;
  embedding: EmbeddingConfig;
  chat: ChatConfig;
  ragSettings?: RagSettings | null;
  cohereApiKey?: string | null;
  onUsage?: ProviderUsageListener;
  abortSignal?: AbortSignal;
  onPassages: (passages: KnowledgePassage[], chunks: RetrievedChunk[]) => void;
}) {
  return {
    description:
      "Retrieve relevant knowledge passages for the assistant. Returns evidence only (passages with source metadata). Does not answer the user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Standalone search query for retrieval." },
        topK: { type: "number", description: "Max passages to return (1-12)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input: Record<string, unknown>) => {
      const query = typeof input.query === "string" ? input.query : "";
      const topK = typeof input.topK === "number" ? input.topK : undefined;
      const result = await executeSearchKnowledge({
        db: opts.db,
        assistantId: opts.assistantId,
        query,
        topK,
        embedding: opts.embedding,
        chat: opts.chat,
        ragSettings: opts.ragSettings,
        cohereApiKey: opts.cohereApiKey,
        onUsage: opts.onUsage,
        abortSignal: opts.abortSignal,
      });
      opts.onPassages(result.passages, result.chunks);
      // Tool output: passages only — never a final answer or invitation.
      return {
        passages: result.passages,
        meta: result.meta,
      };
    },
  };
}
