import { buildEvalRunDetails } from "@chatai/evals";
import { describe, expect, it } from "vitest";

describe("eval run details hydration", () => {
  it("resolves cited document names for legacy rows without snapshot", () => {
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
            answer: "Answer cites [1][4][3].",
            outcome: "answered_with_context",
            citations: [1, 4, 3],
            citedDocuments: ["doc-1", "doc-4", "doc-3"],
            matched: 3,
            citationMappings: [
              { marker: 1, documentId: "doc-1", chunkId: "chunk-1" },
              { marker: 4, documentId: "doc-4", chunkId: "chunk-4" },
              { marker: 3, documentId: "doc-3", chunkId: "chunk-3" },
            ],
            retrieval: [
              { chunkId: "chunk-1", documentId: "doc-1", documentName: "About", similarity: 0.9 },
              { chunkId: "chunk-2", documentId: "doc-2", documentName: "Billing", similarity: 0.7 },
              { chunkId: "chunk-3", documentId: "doc-3", documentName: "Terms", similarity: 0.6 },
              { chunkId: "chunk-4", documentId: "doc-4", documentName: "Community", similarity: 0.5 },
              { chunkId: "chunk-5", documentId: "doc-5", documentName: "Culture", similarity: 0.4 },
            ],
          },
        },
      ],
      hydration: {
        documentsById: new Map([
          ["doc-1", { id: "doc-1", name: "About 100AFRO", url: "https://example.com/about" }],
          ["doc-3", { id: "doc-3", name: "Terms", url: null }],
          ["doc-4", { id: "doc-4", name: "Community Guide", url: "https://example.com/community" }],
        ]),
        chunksById: new Map([
          ["chunk-1", { id: "chunk-1", content: "About content" }],
          ["chunk-3", { id: "chunk-3", content: "Terms content" }],
          ["chunk-4", { id: "chunk-4", content: "Community content" }],
        ]),
      },
    });

    expect(details.cases[0]?.snapshot?.retrieval.length).toBe(5);
    expect(details.cases[0]?.snapshot?.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ marker: 1, documentName: "About 100AFRO", url: "https://example.com/about" }),
        expect.objectContaining({ marker: 4, documentName: "Community Guide" }),
      ]),
    );
  });
});
