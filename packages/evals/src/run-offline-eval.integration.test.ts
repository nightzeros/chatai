import { buildContextBlocks } from "@chatai/rag/answer";
import { describe, expect, it, vi } from "vitest";

import { buildEvalRunDetails } from "./build-run-details";
import { readPersistedSnapshot } from "./persist-details";
import { runOfflineEvalCase } from "./run-offline-eval";

const chunks = [
  {
    chunkId: "chunk-1",
    documentId: "doc-1",
    documentName: "About 100AFRO",
    content: "100AFRO is a platform for African entertainment fans and creators.",
    similarity: 0.91,
    url: "https://example.com/about",
  },
  {
    chunkId: "chunk-2",
    documentId: "doc-2",
    documentName: "Billing FAQ",
    content: "Billing cycles are monthly.",
    similarity: 0.75,
  },
  {
    chunkId: "chunk-3",
    documentId: "doc-3",
    documentName: "Terms",
    content: "Terms of service apply.",
    similarity: 0.7,
  },
  {
    chunkId: "chunk-4",
    documentId: "doc-4",
    documentName: "Community Guide",
    content: "The community welcomes diverse voices across the diaspora.",
    similarity: 0.66,
    url: "https://example.com/community",
  },
  {
    chunkId: "chunk-5",
    documentId: "doc-5",
    documentName: "Culture Overview",
    content: "Culture content spans music, video, and news.",
    similarity: 0.6,
  },
];

describe("runOfflineEvalCase integration", () => {
  it("persists snapshot retrieval and resolves cited sources in details", async () => {
    const inserted: Array<Record<string, unknown>> = [];
    let selectCount = 0;
    const db = {
      select: () => {
        selectCount += 1;
        if (selectCount === 1) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "case-1", question: "who is 100Afro for", expectedAnswer: null }],
              }),
            }),
          };
        }
        if (selectCount === 2) {
          return {
            from: () => ({
              where: () => ({
                limit: async () => [{ id: "run-1", assistantId: "asst-1", kind: "offline" }],
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: "asst-1",
                  instructions: "Be helpful.",
                  hallucinationMode: "balanced",
                  ragSettings: {},
                },
              ],
            }),
          }),
        };
      },
      insert: () => ({
        values: async (rows: unknown | unknown[]) => {
          inserted.push(...(Array.isArray(rows) ? rows : [rows]));
        },
      }),
    };

    const answer =
      "100AFRO is for fans, artists, and culture enthusiasts across Africa and the diaspora [1][4][3].";
    const generateChat = vi.fn(async (opts?: { prompt?: string }) => {
      if (opts?.prompt?.includes("Score how faithful")) {
        return '{"score":1,"reason":"Supported by retrieved context."}';
      }
      if (opts?.prompt?.includes("Score how relevant the context is")) {
        return '{"score":1,"reason":"Context matches the question."}';
      }
      if (opts?.prompt?.includes("Score how directly the answer")) {
        return '{"score":1,"reason":"Answer addresses the question."}';
      }
      return answer;
    });

    const prepareAnswer = vi.fn(async () => ({
      query: "who is 100Afro for",
      retrieved: chunks,
      decision: { action: "generate", contextSufficient: true, confidence: "high", mode: "balanced" },
      outcome: "answered_with_context",
      confidence: 0.9,
      system: "Use the numbered sources.",
      shouldGenerate: true,
      fallbackText: "I could not find enough information.",
      debug: {
        retrieval: chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          documentName: chunk.documentName,
          similarity: chunk.similarity,
        })),
      },
      providerUsages: [],
    }));

    await runOfflineEvalCase({
      db: db as never,
      runId: "run-1",
      caseId: "case-1",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      embedding: { apiKey: "test", baseURL: "https://example.com/v1", model: "emb", dimensions: 1536 },
      deps: {
        prepareAnswer: prepareAnswer as never,
        generateChat,
      },
    });

    expect(inserted).toHaveLength(4);
    for (const row of inserted) {
      const snapshot = readPersistedSnapshot(row.details as Record<string, unknown>);
      expect(snapshot, "snapshot not persisted").toBeDefined();
      expect(snapshot?.retrieval.length, "snapshot retrieval must be non-empty").toBeGreaterThan(0);
    }

    const citationRow = inserted.find((row) => row.metric === "citationCorrectness");
    expect(citationRow?.details).toMatchObject({
      citationMappings: expect.arrayContaining([
        expect.objectContaining({ marker: 1, documentId: "doc-1" }),
        expect.objectContaining({ marker: 4, documentId: "doc-4" }),
        expect.objectContaining({ marker: 3, documentId: "doc-3" }),
      ]),
    });

    const details = buildEvalRunDetails({
      run: {
        id: "run-1",
        assistantId: "asst-1",
        kind: "offline",
        status: "completed",
        createdAt: "2026-08-18T03:00:00.000Z",
      },
      cases: [{ id: "case-1", question: "who is 100Afro for", expectedAnswer: null }],
      scores: inserted.map((row, index) => ({
        id: `score-${index}`,
        caseId: "case-1",
        metric: String(row.metric),
        score: 1,
        details: row.details as Record<string, unknown>,
      })),
      hydration: {
        documentsById: new Map([
          ["doc-1", { id: "doc-1", name: "About 100AFRO", url: "https://example.com/about" }],
          ["doc-3", { id: "doc-3", name: "Terms", url: null }],
          ["doc-4", { id: "doc-4", name: "Community Guide", url: "https://example.com/community" }],
        ]),
        chunksById: new Map(chunks.map((chunk) => [chunk.chunkId, { id: chunk.chunkId, content: chunk.content }])),
      },
    });

    const item = details.cases[0];
    expect(item?.snapshot?.retrieval.length).toBeGreaterThan(0);
    expect(item?.snapshot?.context).toBe(buildContextBlocks(chunks));
    expect(item?.snapshot?.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marker: 1, documentName: "About 100AFRO" }),
        expect.objectContaining({ marker: 4, documentName: "Community Guide" }),
        expect.objectContaining({ marker: 3, documentName: "Terms" }),
      ]),
    );
    expect(item?.retrievalInconsistent).not.toBe(true);
  });

  it("reconstructs legacy rows from citation metric details and hydration maps", () => {
    const details = buildEvalRunDetails({
      run: {
        id: "run-legacy",
        assistantId: "asst-1",
        kind: "offline",
        status: "completed",
        createdAt: "2026-08-18T03:00:00.000Z",
      },
      cases: [{ id: "case-1", question: "who is 100Afro for", expectedAnswer: null }],
      scores: [
        {
          id: "score-citation",
          caseId: "case-1",
          metric: "citationCorrectness",
          score: 1,
          details: {
            judge: "llm",
            answer: "Answer [1][4][3].",
            outcome: "answered_with_context",
            citations: [1, 4, 3],
            citedDocuments: ["doc-1", "doc-4", "doc-3"],
            matched: 3,
            citationMappings: [
              { marker: 1, documentId: "doc-1", chunkId: "chunk-1" },
              { marker: 4, documentId: "doc-4", chunkId: "chunk-4" },
              { marker: 3, documentId: "doc-3", chunkId: "chunk-3" },
            ],
            retrieval: chunks.map((chunk) => ({
              chunkId: chunk.chunkId,
              documentId: chunk.documentId,
              documentName: chunk.documentName,
              similarity: chunk.similarity,
            })),
          },
        },
      ],
      hydration: {
        documentsById: new Map([
          ["doc-1", { id: "doc-1", name: "About 100AFRO", url: "https://example.com/about" }],
          ["doc-3", { id: "doc-3", name: "Terms", url: null }],
          ["doc-4", { id: "doc-4", name: "Community Guide", url: "https://example.com/community" }],
        ]),
        chunksById: new Map(chunks.map((chunk) => [chunk.chunkId, { id: chunk.chunkId, content: chunk.content }])),
      },
    });

    expect(details.cases[0]?.snapshot?.retrieval).toHaveLength(5);
    expect(details.cases[0]?.snapshot?.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marker: 1, documentName: "About 100AFRO" }),
        expect.objectContaining({ marker: 4, documentName: "Community Guide" }),
      ]),
    );
  });
});
