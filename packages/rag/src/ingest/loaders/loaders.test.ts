import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanContent } from "../clean";
import { extractFromFile, extractFromText } from "../extract";
import { hashExtractedBlocks } from "../hash";
import { getLoader, loaderTypeForDocument, registerLoader } from "./index";

const ctx = { fetch, userAgent: "ChatAIBot" };

function sha256(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("loader registry", () => {
  it("returns file, text, faq, and website loaders", () => {
    expect(getLoader("file").type).toBe("file");
    expect(getLoader("text").type).toBe("text");
    expect(getLoader("faq").type).toBe("faq");
    expect(getLoader("website").type).toBe("website");
  });

  it("maps crawled url documents onto the website loader type", () => {
    expect(loaderTypeForDocument("url")).toBe("website");
    expect(loaderTypeForDocument("file")).toBe("file");
    expect(loaderTypeForDocument("faq")).toBe("faq");
  });

  it("throws for an unknown loader type", () => {
    expect(() => getLoader("github")).toThrow(/unknown loader type/i);
  });

  it("lets a later loader register without changing ingest callers", () => {
    registerLoader({
      type: "github",
      async discover() {
        return [];
      },
      async extract() {
        return { blocks: [], contentHash: "" };
      },
    });
    expect(getLoader("github").type).toBe("github");
  });
});

describe("text and faq loaders", () => {
  it("extracts the same blocks as extractFromText", async () => {
    const content = "# Billing\n\nRefunds take 14 days.\n\n# Shipping\n\nWe ship worldwide.";
    const expected = extractFromText(content);

    await expect(getLoader("text").extract({ key: "t1", name: "Notes", content }, ctx)).resolves.toEqual({
      blocks: expected,
      contentHash: hashExtractedBlocks(expected),
    });
    await expect(getLoader("faq").extract({ key: "f1", name: "Refunds", content }, ctx)).resolves.toEqual({
      blocks: expected,
      contentHash: hashExtractedBlocks(expected),
    });
  });

  it("hashes normalized extracted content, not raw source text", async () => {
    const messy = "Hello   world\r\n\r\n\r\n";
    const result = await getLoader("text").extract({ key: "t1", name: "Notes", content: messy }, ctx);
    const normalized = result.blocks.map((block) => cleanContent(block.content)).join("\n\n");

    expect(result.contentHash).toBe(sha256(normalized));
    expect(result.contentHash).not.toBe(sha256(messy));
    expect(result.blocks[0]?.content).toBe("Hello world");
  });
});

describe("file loader", () => {
  it("extracts markdown files with the same heading blocks as extractFromFile", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "chatai-rag-"));
    const storagePath = path.join(dir, "policy.md");
    const body = "# Returns\n\nYou have 30 days.";
    await writeFile(storagePath, body);

    const expected = await extractFromFile({ storagePath, name: "policy.md", mimeType: "text/markdown" });
    const result = await getLoader("file").extract(
      { key: "d1", name: "policy.md", mimeType: "text/markdown", storagePath },
      ctx,
    );

    expect(result.blocks).toEqual(expected);
    expect(result.contentHash).toBe(hashExtractedBlocks(expected));
  });
});
