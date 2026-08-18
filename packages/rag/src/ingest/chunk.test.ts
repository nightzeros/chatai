import { describe, expect, it } from "vitest";

import {
  CHILD_TARGET_TOKENS,
  chunkBlocks,
  chunkBlocksParentChild,
  PARENT_TARGET_TOKENS,
  STANDARD_TARGET_TOKENS,
} from "./chunk";
import type { ExtractedBlock } from "./types";

function repeatWord(word: string, count: number) {
  return Array.from({ length: count }, () => word).join(" ");
}

describe("chunkBlocks standard mode", () => {
  it("keeps the existing ~500-token chunking behavior", () => {
    const blocks: ExtractedBlock[] = [{ content: repeatWord("alpha", 600) }];
    const chunks = chunkBlocks(blocks, "standard");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => !chunk.parentContent)).toBe(true);
    expect(chunks.every((chunk) => chunk.content.length <= STANDARD_TARGET_TOKENS * 4 + 50 * 4)).toBe(
      true,
    );
  });
});

describe("chunkBlocksParentChild", () => {
  it("creates child chunks with shared parentContent passages", () => {
    const blocks: ExtractedBlock[] = [
      {
        heading: "Returns",
        content: repeatWord("policy", 400),
      },
    ];

    const chunks = chunkBlocksParentChild(blocks);

    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((chunk) => chunk.parentContent)).size).toBe(1);
    expect(chunks.every((chunk) => chunk.parentContent && chunk.parentContent.length >= chunk.content.length)).toBe(
      true,
    );
    expect(chunks.every((chunk) => chunk.metadata.parentIndex === 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.content.length <= CHILD_TARGET_TOKENS * 4 + 25 * 4)).toBe(true);
    expect(chunks[0]?.parentContent!.length).toBeLessThanOrEqual(PARENT_TARGET_TOKENS * 4);
  });

  it("assigns distinct parent groups across long documents", () => {
    const blocks: ExtractedBlock[] = [{ content: repeatWord("detail", 3000) }];
    const chunks = chunkBlocksParentChild(blocks);
    const parentIndexes = new Set(chunks.map((chunk) => chunk.metadata.parentIndex));

    expect(parentIndexes.size).toBeGreaterThan(1);
  });

  it("is selected when chunkBlocks is called with parent_child mode", () => {
    const blocks: ExtractedBlock[] = [{ content: repeatWord("term", 1000) }];
    const chunks = chunkBlocks(blocks, "parent_child");

    expect(chunks.some((chunk) => chunk.parentContent)).toBe(true);
  });
});
