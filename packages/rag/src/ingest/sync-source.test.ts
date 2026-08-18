import { beforeEach, describe, expect, it, vi } from "vitest";
import { documents, ingestJobs, sources } from "@chatai/database";

import { syncSource } from "./sync-source";

const discover = vi.fn();

vi.mock("./loaders", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    getLoader: () => ({
      type: "website",
      discover,
      extract: vi.fn(),
    }),
  };
});

const guideUrl = "https://docs.example.com/guide";
const pricingUrl = "https://docs.example.com/pricing";

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "src-1",
    assistantId: "asst-1",
    type: "website" as const,
    name: "Docs",
    originKey: "https://docs.example.com",
    config: { startUrl: "https://docs.example.com/" },
    status: "pending" as const,
    error: null,
    lastSyncedAt: null,
    scheduleCron: null,
    nextRunAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createFakeDb(
  source: ReturnType<typeof sourceRow>,
  initialDocuments: Array<Record<string, unknown>> = [],
  documentLookup: Array<Record<string, unknown> | null> = [],
) {
  const state = {
    source: { ...source },
    documents: initialDocuments.map((doc) => ({ ...doc })),
    insertedDocuments: [] as Array<Record<string, unknown>>,
    ingestJobs: [] as Array<Record<string, unknown>>,
    documentLookupIndex: 0,
    documentLookup,
  };

  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === sources) return [state.source];
            if (table === documents) {
              const match = state.documentLookup[state.documentLookupIndex];
              state.documentLookupIndex += 1;
              return match ? [match] : [];
            }
            return [];
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === sources) {
            Object.assign(state.source, values);
            return;
          }
          if (table === documents) {
            const target = state.documents.find((doc) => doc.id === values.__targetId) ??
              state.documents.find((doc) => doc.status === "pending" || doc.__lastSelected);
            if (target) Object.assign(target, values);
          }
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const rows = Array.isArray(row) ? row : [row];
        if (table === documents) {
          for (const entry of rows) {
            state.documents.push({ ...entry });
            state.insertedDocuments.push(entry);
          }
        }
        if (table === ingestJobs) state.ingestJobs.push(...rows);
      },
    }),
  };

  return { db, state };
}

describe("syncSource", () => {
  beforeEach(() => {
    discover.mockReset();
    discover.mockResolvedValue([
      { key: guideUrl, name: "guide", url: guideUrl },
      { key: pricingUrl, name: "pricing", url: pricingUrl },
    ]);
  });

  it("upserts url documents and enqueues ingest jobs", async () => {
    const { db, state } = createFakeDb(sourceRow(), [], [null, null]);

    const result = await syncSource({ sourceId: "src-1", db: db as never });

    expect(result).toEqual({ discovered: 2, enqueued: 2 });
    expect(state.insertedDocuments).toHaveLength(2);
    expect(state.ingestJobs).toHaveLength(2);
    expect(state.ingestJobs.every((job) => job.kind === "ingest")).toBe(true);
    expect(state.source.status).toBe("ready");
    expect(state.source.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("skips excluded pages without enqueueing ingest jobs for them", async () => {
    const excluded = {
      id: "doc-old",
      sourceId: "src-1",
      url: guideUrl,
      excluded: true,
      name: "old guide",
    };
    const { db, state } = createFakeDb(sourceRow(), [excluded], [excluded, null]);

    const result = await syncSource({ sourceId: "src-1", db: db as never });

    expect(result.enqueued).toBe(1);
    expect(state.ingestJobs).toHaveLength(1);
    expect(state.insertedDocuments).toHaveLength(1);
    expect(state.insertedDocuments[0]?.url).toBe(pricingUrl);
  });

  it("does not delete documents missing from the latest crawl", async () => {
    const legacy = {
      id: "doc-stale",
      sourceId: "src-1",
      url: "https://docs.example.com/legacy",
      excluded: false,
      name: "legacy",
    };
    const { db, state } = createFakeDb(sourceRow(), [legacy], [null, null]);

    await syncSource({ sourceId: "src-1", db: db as never });

    expect(state.documents.some((doc) => doc.url === "https://docs.example.com/legacy")).toBe(true);
  });

  it("marks the source failed when discovery returns no pages", async () => {
    discover.mockResolvedValueOnce([]);
    const { db, state } = createFakeDb(sourceRow());

    await expect(syncSource({ sourceId: "src-1", db: db as never })).rejects.toThrow(/no pages discovered/i);
    expect(state.source.status).toBe("failed");
  });
});
