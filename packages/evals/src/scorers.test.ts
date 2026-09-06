import { describe, expect, it } from "vitest";

import { parseJudgeScore } from "./parse-score";
import { scoreCitationCorrectness } from "./scorers";
import type { EvalContext } from "./types";

describe("parseJudgeScore", () => {
  it("parses bare numeric judge output", () => {
    expect(parseJudgeScore("0.65")).toBe(0.65);
  });
});

describe("scoreCitationCorrectness", () => {
  const base: EvalContext = {
    question: "Question",
    answer: "Answer without citations.",
    context: "Context",
    sources: [{ documentId: "doc-1", documentName: "Doc" }],
    retrieval: [
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "Doc",
        similarity: 0.8,
      },
    ],
  };

  it("marks invalid citation indexes as zero", async () => {
    const result = await scoreCitationCorrectness({
      ...base,
      answer: "This is wrong [9].",
    });
    expect(result.score.score).toBe(0);
  });

  it("rewards valid citations that map to attached sources", async () => {
    const result = await scoreCitationCorrectness({
      ...base,
      answer: "Supported claim [1].",
      sources: [{ documentId: "doc-1", documentName: "Doc", chunkId: "chunk-1" }],
    });
    expect(result.score.score).toBe(1);
  });
});
