import { describe, expect, it } from "vitest";

import { buildEvalRunDetails } from "@chatai/evals";

describe("getEvalRunDetails offline retrieval display", () => {
  it("returns enriched retrieval chunks for cited offline answers", () => {
    const details = buildEvalRunDetails({
      run: {
        id: "run-1",
        assistantId: "asst-1",
        evalSetId: "set-1",
        evalSetName: "Refunds",
        kind: "offline",
        status: "completed",
        createdAt: "2026-08-17T12:00:00.000Z",
      },
      cases: [
        {
          id: "case-1",
          question: "What is the refund policy?",
          expectedAnswer: "30 days",
        },
      ],
      scores: [
        {
          id: "score-1",
          caseId: "case-1",
          metric: "faithfulness",
          score: 1,
          details: {
            judge: "llm",
            reason: "Supported by retrieved context.",
            snapshot: {
              question: "What is the refund policy?",
              expectedAnswer: "30 days",
              answer: "Refund within 30 days [1] and shipping in 5 days [5].",
              outcome: "answered_with_context",
              context:
                "[1] Refund Policy\nRefunds within 30 days.\n\n[2] Billing FAQ\nBilling cycles.\n\n[3] Terms\nTerms text.\n\n[4] Support\nSupport text.\n\n[5] Shipping Guide\nDelivery in 5 days.",
              sources: [
                { documentId: "doc-1", documentName: "Refund Policy", chunkId: "chunk-1" },
                { documentId: "doc-5", documentName: "Shipping Guide", chunkId: "chunk-5" },
              ],
              retrieval: [],
              citations: [],
              debug: {
                retrieval: [
                  { chunkId: "chunk-1", documentId: "doc-1", documentName: "Refund Policy", similarity: 0.91 },
                  { chunkId: "chunk-2", documentId: "doc-2", documentName: "Billing FAQ", similarity: 0.75 },
                  { chunkId: "chunk-3", documentId: "doc-3", documentName: "Terms", similarity: 0.7 },
                  { chunkId: "chunk-4", documentId: "doc-4", documentName: "Support", similarity: 0.65 },
                  { chunkId: "chunk-5", documentId: "doc-5", documentName: "Shipping Guide", similarity: 0.6 },
                ],
              },
            },
          },
        },
      ],
    });

    const item = details.cases[0];
    expect(item?.expectedAnswer).toBe("30 days");
    expect(item?.snapshot?.retrieval.length).toBeGreaterThanOrEqual(2);
    expect(item?.snapshot?.retrieval.some((chunk) => chunk.index === 1 && chunk.documentName === "Refund Policy")).toBe(
      true,
    );
    expect(item?.snapshot?.retrieval.some((chunk) => chunk.index === 5 && chunk.documentName === "Shipping Guide")).toBe(
      true,
    );
    expect(item?.snapshot?.citations.map((citation) => citation.marker)).toEqual([1, 5]);
  });
});
