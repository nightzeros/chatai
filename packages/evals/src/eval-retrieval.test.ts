import { describe, expect, it } from "vitest";

import {
  enrichEvalCaseSnapshot,
  parseContextBlocks,
  toEvalDebugRetrieval,
} from "./eval-retrieval";
import type { EvalCaseSnapshot } from "./eval-snapshot";

describe("parseContextBlocks", () => {
  it("parses numbered context blocks sent to the answer model", () => {
    expect(
      parseContextBlocks(
        "[1] Refund Policy\nRefunds within 30 days.\n\n[5] Shipping Guide, page 2\nDelivery in 5 days.",
      ),
    ).toEqual([
      {
        index: 1,
        documentName: "Refund Policy",
        content: "Refunds within 30 days.",
      },
      {
        index: 5,
        documentName: "Shipping Guide",
        page: 2,
        content: "Delivery in 5 days.",
      },
    ]);
  });
});

describe("enrichEvalCaseSnapshot", () => {
  it("reconstructs retrieval from stored context and debug metadata", () => {
    const incomplete: EvalCaseSnapshot = {
      question: "What is the refund policy?",
      expectedAnswer: "30 days",
      answer: "You can request a refund within 30 days [1], and shipping takes 5 days [5].",
      outcome: "answered_with_context",
      context: "[1] Refund Policy\nRefunds within 30 days.\n\n[5] Shipping Guide\nDelivery in 5 days.",
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
    };

    const enriched = enrichEvalCaseSnapshot(incomplete);

    expect(enriched.retrieval).toHaveLength(2);
    expect(enriched.retrieval[0]).toMatchObject({
      index: 1,
      chunkId: "chunk-1",
      documentName: "Refund Policy",
      content: "Refunds within 30 days.",
    });
    expect(enriched.retrieval[1]).toMatchObject({
      index: 5,
      chunkId: "chunk-5",
      documentName: "Shipping Guide",
      content: "Delivery in 5 days.",
    });
    expect(enriched.citations).toEqual([
      {
        marker: 1,
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "Refund Policy",
      },
      {
        marker: 5,
        chunkId: "chunk-5",
        documentId: "doc-5",
        documentName: "Shipping Guide",
      },
    ]);
  });
});

describe("toEvalDebugRetrieval", () => {
  it("aligns debug retrieval metadata with context chunk order", () => {
    expect(
      toEvalDebugRetrieval([
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentName: "Refund Policy",
          content: "Refunds within 30 days.",
          similarity: 0.9123,
        },
      ]),
    ).toEqual([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "Refund Policy",
        similarity: 0.9123,
      },
    ]);
  });
});
