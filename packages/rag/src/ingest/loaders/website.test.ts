import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { hashExtractedBlocks } from "../hash";
import { websiteLoader } from "./website";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const sampleHtml = readFileSync(path.join(fixtureDir, "sample-page.html"), "utf8");

const ctx = {
  userAgent: "ChatAIBot",
  fetch: vi.fn(async () => new Response(sampleHtml, { status: 200 })),
};

describe("website loader", () => {
  it("extracts markdown heading blocks from fetched HTML", async () => {
    const result = await websiteLoader.extract(
      { key: "https://docs.example.com/guide", name: "guide", url: "https://docs.example.com/guide" },
      ctx,
    );

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.some((block) => block.heading === "Getting started")).toBe(true);
    expect(result.contentHash).toBe(hashExtractedBlocks(result.blocks));
    expect(ctx.fetch).toHaveBeenCalledWith(
      "https://docs.example.com/guide",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": "ChatAIBot" }) }),
    );
  });

  it("requires a URL for extraction", async () => {
    await expect(websiteLoader.extract({ key: "missing", name: "missing" }, ctx)).rejects.toThrow(
      /require a URL/i,
    );
  });
});
