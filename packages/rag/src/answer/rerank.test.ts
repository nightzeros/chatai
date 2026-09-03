import { describe, expect, it, vi } from "vitest";

import { cohereRerank } from "./cohere-rerank";
import { rerank, RERANK_OUTPUT_LIMIT } from "./rerank";
import type { RetrievedChunk } from "./retrieve";

function chunk(id: string, content: string): RetrievedChunk {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    documentName: id,
    content,
    similarity: 0.5,
  };
}

function makeChunks(count: number) {
  return Array.from({ length: count }, (_, index) => chunk(`chunk-${index + 1}`, `content ${index + 1}`));
}

describe("rerank", () => {
  it("passes through when reranking is disabled", async () => {
    const input = makeChunks(12);
    const result = await rerank({
      chunks: input,
      query: "pricing",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      enabled: false,
    });

    expect(result.provider).toBe("none");
    expect(result.chunks).toHaveLength(RERANK_OUTPUT_LIMIT);
    expect(result.chunks[0]?.chunkId).toBe("chunk-1");
  });

  it("reorders chunks with the LLM listwise path", async () => {
    const input = makeChunks(10);
    const result = await rerank({
      chunks: input,
      query: "pricing",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      deps: {
        generateChat: async () => '["chunk-3","chunk-1","chunk-8"]',
        cohereRerank,
      },
    });

    expect(result.provider).toBe("llm");
    expect(result.chunks.map((item) => item.chunkId).slice(0, 3)).toEqual([
      "chunk-3",
      "chunk-1",
      "chunk-8",
    ]);
    expect(result.chunks[0]?.similarity).toBe(1);
    expect(result.order[0]).toMatchObject({ chunkId: "chunk-3", rank: 1, priorRank: 3 });
  });

  it("uses Cohere when an API key is provided", async () => {
    const input = makeChunks(10);
    const cohereRerankMock = vi.fn(async () => ({
      results: [
        { index: 2, relevanceScore: 0.91 },
        { index: 0, relevanceScore: 0.82 },
      ],
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 },
      model: "rerank-english-v3.0",
      provider: "cohere" as const,
    }));

    const result = await rerank({
      chunks: input,
      query: "pricing",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      cohereApiKey: "cohere-key",
      deps: {
        generateChat: async () => "[]",
        cohereRerank: cohereRerankMock,
      },
    });

    expect(cohereRerankMock).toHaveBeenCalledOnce();
    expect(result.provider).toBe("cohere");
    expect(result.chunks[0]?.chunkId).toBe("chunk-3");
    expect(result.chunks[0]?.rerank?.score).toBe(0.91);
  });

  it("falls back to LLM rerank when Cohere fails", async () => {
    const input = makeChunks(10);
    const result = await rerank({
      chunks: input,
      query: "pricing",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      cohereApiKey: "cohere-key",
      deps: {
        generateChat: async () => '["chunk-5","chunk-2"]',
        cohereRerank: async () => {
          throw new Error("Cohere unavailable");
        },
      },
    });

    expect(result.provider).toBe("llm");
    expect(result.chunks[0]?.chunkId).toBe("chunk-5");
  });
});

describe("cohereRerank", () => {
  it("maps Cohere response indices to relevance scores", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        results: [
          { index: 1, relevance_score: 0.77 },
          { index: 0, relevance_score: 0.55 },
        ],
      }),
    );

    const results = await cohereRerank({
      apiKey: "cohere-key",
      query: "support hours",
      documents: ["first", "second"],
      topN: 2,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(results.results).toEqual([
      { index: 1, relevanceScore: 0.77 },
      { index: 0, relevanceScore: 0.55 },
    ]);
    expect(results.provider).toBe("cohere");
    expect(results.model).toBe("rerank-english-v3.0");
  });
});
