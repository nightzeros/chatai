import { describe, expect, it } from "vitest";

import { hashExtractedBlocks, shouldSkipReembed } from "./hash";

describe("hashExtractedBlocks", () => {
  it("is stable for the same normalized blocks", () => {
    const first = hashExtractedBlocks([{ content: "Hello   world" }, { content: "Second" }]);
    const second = hashExtractedBlocks([{ content: "Hello world" }, { content: "Second" }]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when extracted content changes", () => {
    expect(hashExtractedBlocks([{ content: "A" }])).not.toBe(hashExtractedBlocks([{ content: "B" }]));
  });
});

describe("shouldSkipReembed", () => {
  it("skips when the stored hash matches and chunks already exist", () => {
    expect(
      shouldSkipReembed({
        storedHash: "abc",
        nextHash: "abc",
        chunkCount: 3,
      }),
    ).toBe(true);
  });

  it("does not skip when forced", () => {
    expect(
      shouldSkipReembed({
        storedHash: "abc",
        nextHash: "abc",
        chunkCount: 3,
        force: true,
      }),
    ).toBe(false);
  });

  it("does not skip when there are no chunks yet", () => {
    expect(
      shouldSkipReembed({
        storedHash: "abc",
        nextHash: "abc",
        chunkCount: 0,
      }),
    ).toBe(false);
  });

  it("does not skip when the hash changed", () => {
    expect(
      shouldSkipReembed({
        storedHash: "old",
        nextHash: "new",
        chunkCount: 2,
      }),
    ).toBe(false);
  });
});
