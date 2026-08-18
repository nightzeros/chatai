import { describe, expect, it } from "vitest";

import { buildEvalRunDetails } from "./build-run-details";
import type { EvalCaseSnapshot } from "./eval-snapshot";

const snapshot: EvalCaseSnapshot = {
  question: "What is the refund policy?",
  expectedAnswer: "30 days",
  answer: "Refunds are available within 30 days [1].",
  outcome: "answered_with_context",
  context: "Policy\nRefunds are available within 30 days.",
  sources: [{ documentId: "doc-1", documentName: "Policy", chunkId: "chunk-1" }],
  retrieval: [
    {
      index: 1,
      chunkId: "chunk-1",
      documentId: "doc-1",
      documentName: "Policy",
      similarity: 0.9,
      content: "Refunds are available within 30 days.",
    },
  ],
  citations: [{ marker: 1, chunkId: "chunk-1", documentId: "doc-1", documentName: "Policy" }],
  model: "gpt-test",
};

describe("buildEvalRunDetails", () => {
  it("groups metric scores and attaches stored snapshots", () => {
    const details = buildEvalRunDetails({
      run: {
        id: "run-1",
        assistantId: "asst-1",
        evalSetId: "set-1",
        evalSetName: "Refunds",
        kind: "offline",
        status: "completed",
        summary: { averages: { faithfulness: 1 } },
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
          details: { judge: "llm", reason: "Supported by context.", snapshot },
        },
        {
          id: "score-2",
          caseId: "case-1",
          metric: "answerRelevance",
          score: 0.8,
          details: { judge: "llm", reason: "Mostly on topic.", snapshot },
        },
      ],
    });

    expect(details.cases).toHaveLength(1);
    expect(details.cases[0]?.metrics).toHaveLength(2);
    expect(details.cases[0]?.snapshot?.answer).toContain("Refunds");
    expect(details.cases[0]?.metrics.find((metric) => metric.metric === "faithfulness")?.reason).toBe(
      "Supported by context.",
    );
  });

  it("falls back safely for legacy runs without snapshots", () => {
    const details = buildEvalRunDetails({
      run: {
        id: "run-legacy",
        assistantId: "asst-1",
        kind: "offline",
        status: "completed",
        createdAt: "2026-08-17T12:00:00.000Z",
      },
      cases: [
        {
          id: "case-legacy",
          question: "Legacy question",
          expectedAnswer: null,
        },
      ],
      scores: [
        {
          id: "score-legacy",
          caseId: "case-legacy",
          metric: "faithfulness",
          score: 0.5,
          details: { judge: "llm", answer: "Legacy answer snippet", outcome: "answered_with_context" },
        },
      ],
    });

    expect(details.cases[0]?.question).toBe("Legacy question");
    expect(details.cases[0]?.answer).toBe("Legacy answer snippet");
    expect(details.cases[0]?.outcome).toBe("answered_with_context");
    expect(details.cases[0]?.snapshot?.retrieval).toEqual([]);
    expect(details.cases[0]?.metrics[0]?.score).toBe(0.5);
  });

  it("reconstructs offline retrieval for stored snapshots missing chunk arrays", () => {
    const details = buildEvalRunDetails({
      run: {
        id: "run-offline",
        assistantId: "asst-1",
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
          metric: "citationCorrectness",
          score: 1,
          details: {
            citations: [1, 5],
            citedDocuments: ["doc-1", "doc-5"],
            matched: 2,
            snapshot: {
              question: "What is the refund policy?",
              expectedAnswer: "30 days",
              answer: "Refund within 30 days [1] and shipping in 5 days [5].",
              outcome: "answered_with_context",
              context:
                "[1] Refund Policy\nRefunds within 30 days.\n\n[5] Shipping Guide\nDelivery in 5 days.",
              sources: [
                { documentId: "doc-1", documentName: "Refund Policy", chunkId: "chunk-1" },
                { documentId: "doc-5", documentName: "Shipping Guide", chunkId: "chunk-5" },
              ],
              retrieval: [],
              citations: [],
              debug: {
                retrieval: [
                  {
                    chunkId: "chunk-1",
                    documentId: "doc-1",
                    documentName: "Refund Policy",
                    similarity: 0.91,
                  },
                  {
                    chunkId: "chunk-2",
                    documentId: "doc-2",
                    documentName: "Billing FAQ",
                    similarity: 0.75,
                  },
                  {
                    chunkId: "chunk-3",
                    documentId: "doc-3",
                    documentName: "Terms",
                    similarity: 0.7,
                  },
                  {
                    chunkId: "chunk-4",
                    documentId: "doc-4",
                    documentName: "Support",
                    similarity: 0.65,
                  },
                  {
                    chunkId: "chunk-5",
                    documentId: "doc-5",
                    documentName: "Shipping Guide",
                    similarity: 0.6,
                  },
                ],
              },
            },
          },
        },
        {
          id: "score-2",
          caseId: "case-1",
          metric: "contextRelevance",
          score: 1,
          details: { judge: "llm", reason: "Context matches the question." },
        },
      ],
    });

    expect(details.cases[0]?.snapshot?.retrieval).toHaveLength(2);
    expect(details.cases[0]?.snapshot?.retrieval[0]?.documentName).toBe("Refund Policy");
    expect(details.cases[0]?.snapshot?.retrieval[1]?.index).toBe(5);
    expect(details.cases[0]?.snapshot?.citations).toHaveLength(2);
  });

  it("reconstructs online cases from stored messages when snapshots are missing", () => {
    const details = buildEvalRunDetails({
      run: {
        id: "run-online",
        assistantId: "asst-1",
        kind: "online",
        status: "completed",
        createdAt: "2026-08-17T12:00:00.000Z",
      },
      messages: [
        {
          id: "msg-1",
          content: "Online answer",
          sources: [{ documentId: "doc-1", documentName: "Doc" }],
          outcome: "answered_with_context",
          debug: {
            question: "Online question",
            retrieval: [
              {
                chunkId: "chunk-1",
                documentId: "doc-1",
                documentName: "Doc",
                similarity: 0.7,
              },
            ],
          },
        },
      ],
      scores: [
        {
          id: "score-online",
          messageId: "msg-1",
          metric: "faithfulness",
          score: 0.9,
          details: { judge: "llm" },
        },
      ],
    });

    expect(details.cases[0]?.question).toBe("Online question");
    expect(details.cases[0]?.answer).toBe("Online answer");
    expect(details.cases[0]?.snapshot?.retrieval).toHaveLength(1);
  });
});
