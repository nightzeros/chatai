import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractFromText } from "./extract";
import { hashExtractedBlocks } from "./hash";
import { ingestDocument } from "./ingest-document";

const embedMany = vi.fn();

vi.mock("@chatai/ai", () => ({
  embedMany: (...args: unknown[]) => embedMany(...args),
}));

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    assistantId: "asst-1",
    sourceId: null,
    type: "text" as const,
    name: "Notes",
    mimeType: "text/plain",
    status: "ready" as const,
    error: null,
    chunkCount: 2,
    content: "Hello world",
    storagePath: null,
    url: null,
    contentHash: hashExtractedBlocks(extractFromText("Hello world")),
    excluded: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createFakeDb(row: ReturnType<typeof documentRow>) {
  const state = {
    document: { ...row },
    ragSettings: {},
    chunks: [{ id: "c1" }] as unknown[],
    deleted: false,
  };

  const db = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => [{ document: state.document, ragSettings: state.ragSettings }],
          }),
        }),
        where: () => ({
          limit: async () => [state.document],
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          Object.assign(state.document, values);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        state.deleted = true;
        state.chunks = [];
      },
    }),
    insert: () => ({
      values: async (rows: unknown[]) => {
        state.chunks = rows;
      },
    }),
  };

  return { db, state };
}

const embedding = { apiKey: "test", baseURL: "https://example.com", model: "emb", dimensions: 1536 };

describe("ingestDocument", () => {
  beforeEach(() => {
    embedMany.mockReset();
    embedMany.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      usage: { inputTokens: 3, outputTokens: 0, cachedInputTokens: 0, totalTokens: 3 },
    });
  });

  it("skips embedding when extracted content has not changed", async () => {
    const { db, state } = createFakeDb(documentRow());

    const result = await ingestDocument({
      documentId: "doc-1",
      db: db as never,
      embedding,
    });

    expect(result).toEqual({ chunkCount: 2, skipped: true });
    expect(embedMany).not.toHaveBeenCalled();
    expect(state.deleted).toBe(false);
    expect(state.document.status).toBe("ready");
    expect(state.document.contentHash).toBe(hashExtractedBlocks(extractFromText("Hello world")));
  });

  it("re-embeds when force is set even if the hash matches", async () => {
    const { db, state } = createFakeDb(documentRow());

    const result = await ingestDocument({
      documentId: "doc-1",
      db: db as never,
      embedding,
      force: true,
    });

    expect(result.skipped).toBeFalsy();
    expect(embedMany).toHaveBeenCalledOnce();
    expect(state.deleted).toBe(true);
    expect(state.document.status).toBe("ready");
    expect(state.document.chunkCount).toBe(1);
  });

  it("invokes beforeEmbed after chunking and before embedMany", async () => {
    const { db } = createFakeDb(
      documentRow({
        content: "Hello world",
        contentHash: null,
        chunkCount: 0,
      }),
    );
    const beforeEmbed = vi.fn(async () => undefined);

    await ingestDocument({
      documentId: "doc-1",
      db: db as never,
      embedding,
      force: true,
      beforeEmbed,
    });

    expect(beforeEmbed).toHaveBeenCalledOnce();
    expect(beforeEmbed.mock.invocationCallOrder[0]).toBeLessThan(
      embedMany.mock.invocationCallOrder[0]!,
    );
    expect(beforeEmbed).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkCount: expect.any(Number),
        approxTokens: expect.any(Number),
        texts: expect.any(Array),
      }),
    );
  });

  it("does not branch on document.type === \"file\"", async () => {
    const source = await import("node:fs/promises").then((mod) => mod.readFile);
    const body = await source(new URL("./ingest-document.ts", import.meta.url), "utf8");
    expect(body).not.toMatch(/type === ["']file["']/);
  });

  it("stores parentContent when parent_child chunking is enabled", async () => {
    const longContent = Array.from({ length: 1200 }, () => "policy").join(" ");
    const { db, state } = createFakeDb(
      documentRow({
        content: longContent,
        contentHash: null,
        chunkCount: 0,
      }),
    );
    state.ragSettings = { chunkingMode: "parent_child" };
    embedMany.mockImplementation(async (texts: string[]) => ({
      embeddings: texts.map(() => [0.1, 0.2]),
      usage: { inputTokens: texts.length, outputTokens: 0, cachedInputTokens: 0, totalTokens: texts.length },
    }));

    await ingestDocument({
      documentId: "doc-1",
      db: db as never,
      embedding,
      force: true,
    });

    expect(state.chunks.length).toBeGreaterThan(1);
    expect(
      state.chunks.every(
        (row) =>
          typeof row === "object" &&
          row !== null &&
          "parentContent" in row &&
          typeof (row as { parentContent?: string | null }).parentContent === "string",
      ),
    ).toBe(true);
  });
});
