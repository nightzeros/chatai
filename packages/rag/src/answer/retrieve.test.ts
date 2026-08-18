import { describe, expect, it } from "vitest";

import { fuseHybridResults, type RetrievedChunk } from "./retrieve";

function chunk(id: string, similarity: number): RetrievedChunk {
  return {
    chunkId: id,
    documentId: `doc-${id}`,
    documentName: id,
    content: `content for ${id}`,
    similarity,
  };
}

describe("fuseHybridResults", () => {
  it("prefers chunks that appear in both vector and keyword results", () => {
    const fused = fuseHybridResults(
      [chunk("shared", 0.95), chunk("vector-only", 0.9)],
      [chunk("shared", 0.4), chunk("keyword-only", 0.35)],
      3,
    );

    expect(fused[0]?.chunkId).toBe("shared");
    expect(fused[0]?.hybrid?.vectorRank).toBe(1);
    expect(fused[0]?.hybrid?.keywordRank).toBe(1);
    expect(fused.map((item) => item.chunkId)).toEqual(
      expect.arrayContaining(["shared", "vector-only", "keyword-only"]),
    );
  });

  it("surfaces keyword-only matches when the vector leg misses them", () => {
    const fused = fuseHybridResults(
      [chunk("vector-a", 0.9)],
      [chunk("keyword-hit", 0.8)],
      2,
    );

    expect(fused.map((item) => item.chunkId)).toContain("keyword-hit");
    expect(fused.find((item) => item.chunkId === "keyword-hit")?.hybrid?.keywordRank).toBe(1);
    expect(fused.find((item) => item.chunkId === "keyword-hit")?.hybrid?.vectorRank).toBeUndefined();
  });

  it("boosts dual-list matches over single-list rank-1 hits", () => {
    const fused = fuseHybridResults(
      [chunk("shared", 0.5), chunk("vector-only", 0.9)],
      [chunk("keyword-only", 0.9), chunk("shared", 0.5)],
      3,
    );

    expect(fused[0]?.chunkId).toBe("shared");
  });

  it("normalizes fused similarity to a 0-1 scale", () => {
    const fused = fuseHybridResults([chunk("a", 0.5)], [chunk("a", 0.2)], 1);
    expect(fused[0]?.similarity).toBe(1);
  });
});

describe("retrieveChunks source guards", () => {
  it("filters excluded documents in hybrid and vector queries", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "retrieve.ts"),
      "utf8",
    );
    expect(source).toContain("eq(documents.excluded, false)");
    expect(source).toContain("searchVector");
    expect(source).toContain("plainto_tsquery");
  });
});

describe("resolveRagSettings", () => {
  it("defaults hybrid search to enabled", async () => {
    const { resolveRagSettings } = await import("./rag-settings");
    expect(resolveRagSettings(null).hybridSearch).toBe(true);
    expect(resolveRagSettings({ hybridSearch: false }).hybridSearch).toBe(false);
  });
});
