import { describe, expect, it } from "vitest";

import { expandQueries, EXPANSION_TOKEN_THRESHOLD } from "./expand-query";
import { mergeRetrievalLists, type RetrievedChunk } from "./retrieve";

describe("expandQueries", () => {
  it("returns only the original query when expansion is disabled", async () => {
    const result = await expandQueries({
      query: "refund policy",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      enabled: false,
      deps: {
        generateChat: async () => '["alternate"]',
      },
    });

    expect(result).toEqual({
      queries: ["refund policy"],
      expanded: false,
      alternates: [],
    });
  });

  it("skips expansion for long queries", async () => {
    const longQuery = Array.from({ length: EXPANSION_TOKEN_THRESHOLD }, (_, index) => `word${index}`).join(
      " ",
    );

    const result = await expandQueries({
      query: longQuery,
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      enabled: true,
      deps: {
        generateChat: async () => '["alternate"]',
      },
    });

    expect(result.expanded).toBe(false);
    expect(result.queries).toEqual([longQuery]);
  });

  it("adds alternate queries for short ambiguous questions", async () => {
    const result = await expandQueries({
      query: "pricing",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      enabled: true,
      deps: {
        generateChat: async () => '["plan costs","subscription price"]',
      },
    });

    expect(result.expanded).toBe(true);
    expect(result.queries).toEqual(["pricing", "plan costs", "subscription price"]);
    expect(result.alternates).toEqual(["plan costs", "subscription price"]);
  });
});

describe("mergeRetrievalLists", () => {
  function chunk(id: string, similarity: number): RetrievedChunk {
    return {
      chunkId: id,
      documentId: `doc-${id}`,
      documentName: id,
      content: `content ${id}`,
      similarity,
    };
  }

  it("promotes chunks that rank well across expanded queries", () => {
    const merged = mergeRetrievalLists(
      [
        [chunk("shared", 0.9), chunk("query-a-only", 0.8)],
        [chunk("shared", 0.85), chunk("query-b-only", 0.7)],
      ],
      3,
    );

    expect(merged[0]?.chunkId).toBe("shared");
    expect(merged.map((item) => item.chunkId)).toEqual(
      expect.arrayContaining(["shared", "query-a-only", "query-b-only"]),
    );
  });
});
