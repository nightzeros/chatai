import {
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
  type ProviderUsage,
} from "@chatai/ai";

import { cohereRerank, type CohereRerankResponse } from "./cohere-rerank";
import type { ProviderUsageRecord } from "./provider-usage";
import { HYBRID_CANDIDATE_LIMIT, type RetrievedChunk } from "./retrieve";

export const RERANK_OUTPUT_LIMIT = 8;

export type RerankProvider = "none" | "cohere" | "llm";

export type RerankOrderEntry = {
  chunkId: string;
  priorRank: number;
  rank: number;
  score?: number;
};

export type RerankResult = {
  chunks: RetrievedChunk[];
  provider: RerankProvider;
  order: RerankOrderEntry[];
  providerUsages: ProviderUsageRecord[];
};

export type RerankDeps = {
  generateChat: GenerateChatFn;
  cohereRerank: typeof cohereRerank;
};

function rankSimilarity(rank: number, total: number) {
  if (total <= 1) return 1;
  return 1 - (rank - 1) / (total - 1);
}

function buildPassthroughResult(chunks: RetrievedChunk[], limit: number): RerankResult {
  const limited = chunks.slice(0, limit);
  return {
    chunks: limited.map((chunk, index) => ({
      ...chunk,
      similarity: rankSimilarity(index + 1, limited.length),
    })),
    provider: "none",
    order: limited.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      priorRank: index + 1,
      rank: index + 1,
    })),
    providerUsages: [],
  };
}

function parseRankedChunkIds(raw: string, chunkIds: string[]) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const allowed = new Set(chunkIds);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const ids = parsed.filter((item): item is string => typeof item === "string" && allowed.has(item));
      if (ids.length > 0) return ids;
    }
  } catch {
    // Fall back to line-based parsing below.
  }

  const ids = trimmed
    .split("\n")
    .map((line) => line.replace(/^\d+[).-]\s+/, "").trim())
    .filter((line) => allowed.has(line));

  return ids.length > 0 ? ids : null;
}

function buildPrompt(query: string, chunks: RetrievedChunk[]) {
  const passages = chunks
    .map(
      (chunk) =>
        `[${chunk.chunkId}] (${chunk.documentName})\n${chunk.content.slice(0, 500)}${chunk.content.length > 500 ? "..." : ""}`,
    )
    .join("\n\n");

  return `Query: ${query}\n\nPassages:\n${passages}\n\nReturn ONLY a JSON array of passage IDs ordered from most to least relevant.`;
}

function orderChunksByIds(
  chunks: RetrievedChunk[],
  rankedIds: string[],
  limit: number,
  provider: Exclude<RerankProvider, "none">,
  scores?: Map<string, number>,
  providerUsages: ProviderUsageRecord[] = [],
): RerankResult {
  const priorRank = new Map(chunks.map((chunk, index) => [chunk.chunkId, index + 1]));
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const ordered: RetrievedChunk[] = [];
  const seen = new Set<string>();

  for (const chunkId of rankedIds) {
    if (seen.has(chunkId)) continue;
    const chunk = byId.get(chunkId);
    if (!chunk) continue;
    ordered.push(chunk);
    seen.add(chunkId);
    if (ordered.length >= limit) break;
  }

  for (const chunk of chunks) {
    if (ordered.length >= limit) break;
    if (seen.has(chunk.chunkId)) continue;
    ordered.push(chunk);
    seen.add(chunk.chunkId);
  }

  const order: RerankOrderEntry[] = ordered.map((chunk, index) => ({
    chunkId: chunk.chunkId,
    priorRank: priorRank.get(chunk.chunkId) ?? index + 1,
    rank: index + 1,
    ...(scores?.has(chunk.chunkId) ? { score: scores.get(chunk.chunkId) } : {}),
  }));

  return {
    chunks: ordered.map((chunk, index) => ({
      ...chunk,
      similarity: scores?.has(chunk.chunkId)
        ? Number((scores.get(chunk.chunkId) ?? rankSimilarity(index + 1, ordered.length)).toFixed(6))
        : rankSimilarity(index + 1, ordered.length),
      rerank: {
        rank: index + 1,
        priorRank: priorRank.get(chunk.chunkId) ?? index + 1,
        ...(scores?.has(chunk.chunkId) ? { score: scores.get(chunk.chunkId) } : {}),
      },
    })),
    provider,
    order,
    providerUsages,
  };
}

async function rerankWithLlm(opts: {
  chunks: RetrievedChunk[];
  query: string;
  chat: ChatConfig;
  limit: number;
  generateChat: GenerateChatFn;
}): Promise<RerankResult> {
  const { text: raw, usage } = await runGenerateChat(opts.generateChat, {
    config: opts.chat,
    system:
      "You rerank retrieval passages for question answering. Return ONLY a JSON array of passage IDs from most to least relevant.",
    prompt: buildPrompt(opts.query, opts.chunks),
  });

  const rankedIds = parseRankedChunkIds(raw, opts.chunks.map((chunk) => chunk.chunkId));
  const providerUsages: ProviderUsageRecord[] = [
    {
      kind: "chat_completion",
      provider: opts.chat.provider,
      model: opts.chat.model,
      usage,
      step: "rerank_llm",
    },
  ];

  if (!rankedIds) {
    return { ...buildPassthroughResult(opts.chunks, opts.limit), providerUsages };
  }

  return orderChunksByIds(opts.chunks, rankedIds, opts.limit, "llm", undefined, providerUsages);
}

async function rerankWithCohere(opts: {
  chunks: RetrievedChunk[];
  query: string;
  apiKey: string;
  limit: number;
  cohereRerank: typeof cohereRerank;
}): Promise<RerankResult> {
  const response: CohereRerankResponse = await opts.cohereRerank({
    apiKey: opts.apiKey,
    query: opts.query,
    documents: opts.chunks.map((chunk) => chunk.content),
    topN: opts.limit,
  });

  const rankedIds = response.results
    .map((item) => opts.chunks[item.index]?.chunkId)
    .filter(Boolean) as string[];
  const scores = new Map<string, number>();
  for (const item of response.results) {
    const chunkId = opts.chunks[item.index]?.chunkId;
    if (chunkId) {
      scores.set(chunkId, item.relevanceScore);
    }
  }

  const providerUsages: ProviderUsageRecord[] = [
    {
      kind: "rerank",
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      step: "rerank_cohere",
    },
  ];

  return orderChunksByIds(opts.chunks, rankedIds, opts.limit, "cohere", scores, providerUsages);
}

export async function rerank(opts: {
  chunks: RetrievedChunk[];
  query: string;
  chat: ChatConfig;
  enabled?: boolean;
  cohereApiKey?: string | null;
  limit?: number;
  deps?: Partial<RerankDeps>;
}): Promise<RerankResult> {
  const limit = opts.limit ?? RERANK_OUTPUT_LIMIT;
  const enabled = opts.enabled ?? true;
  const chunks = opts.chunks.slice(0, HYBRID_CANDIDATE_LIMIT);

  if (!enabled || chunks.length === 0) {
    return buildPassthroughResult(chunks, limit);
  }

  if (chunks.length <= limit) {
    return buildPassthroughResult(chunks, limit);
  }

  const generate = opts.deps?.generateChat ?? generateChat;
  const cohere = opts.deps?.cohereRerank ?? cohereRerank;

  if (opts.cohereApiKey) {
    try {
      return await rerankWithCohere({
        chunks,
        query: opts.query,
        apiKey: opts.cohereApiKey,
        limit,
        cohereRerank: cohere,
      });
    } catch {
      // Fall back to LLM rerank when Cohere is unavailable.
    }
  }

  try {
    return await rerankWithLlm({
      chunks,
      query: opts.query,
      chat: opts.chat,
      limit,
      generateChat: generate,
    });
  } catch {
    return buildPassthroughResult(chunks, limit);
  }
}

export type { ProviderUsage };
