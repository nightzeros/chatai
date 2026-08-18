import { describe, expect, it } from "vitest";

import { buildEvalCaseSnapshot } from "./eval-snapshot";

describe("buildEvalCaseSnapshot", () => {
  it("captures retrieval, citations, and debug metadata", () => {
    const snapshot = buildEvalCaseSnapshot({
      question: "What is the refund policy?",
      expectedAnswer: "30 days",
      answer: "Refunds are available within 30 days [1].",
      outcome: "answered_with_context",
      retrieved: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          documentName: "Policy",
          content: "Refunds are available within 30 days.",
          similarity: 0.91,
        },
      ],
      sources: [{ documentId: "doc-1", documentName: "Policy", chunkId: "chunk-1" }],
      debug: {
        question: "refund policy",
        expansion: { enabled: true, expanded: true, queries: ["refund policy"] },
      },
      model: "gpt-test",
      provider: "https://example.com/v1",
    });

    expect(snapshot.retrieval).toHaveLength(1);
    expect(snapshot.retrieval[0]?.index).toBe(1);
    expect(snapshot.citations).toEqual([
      {
        marker: 1,
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "Policy",
      },
    ]);
    expect(snapshot.context).toContain("Policy");
    expect(snapshot.debug?.expansion).toMatchObject({ expanded: true });
  });
});
