import { describe, expect, it } from "vitest";

import { buildContextBlocks, contextPassage } from "./prompt";
import type { RetrievedChunk } from "./retrieve";

function chunk(overrides: Partial<RetrievedChunk> & Pick<RetrievedChunk, "chunkId">): RetrievedChunk {
  return {
    documentId: "doc-1",
    documentName: "Policy",
    content: "child snippet",
    similarity: 0.8,
    ...overrides,
  };
}

describe("contextPassage", () => {
  it("prefers parentContent when present", () => {
    expect(
      contextPassage({
        content: "child snippet",
        parentContent: "full parent passage with broader context",
      }),
    ).toBe("full parent passage with broader context");
  });
});

describe("buildContextBlocks", () => {
  it("uses parentContent in the prompt context", () => {
    const context = buildContextBlocks([
      chunk({
        chunkId: "child-1",
        content: "child one",
        parentContent: "shared parent passage",
      }),
    ]);

    expect(context).toContain("shared parent passage");
    expect(context).not.toContain("child one");
  });

  it("deduplicates multiple children that share the same parent passage", () => {
    const context = buildContextBlocks([
      chunk({
        chunkId: "child-1",
        content: "child one",
        parentContent: "shared parent passage",
      }),
      chunk({
        chunkId: "child-2",
        content: "child two",
        parentContent: "shared parent passage",
      }),
    ]);

    expect(context.match(/shared parent passage/g)?.length).toBe(1);
    expect(context).toContain("[1] Policy");
    expect(context).not.toContain("[2]");
  });
});
