import { describe, expect, it } from "vitest";

import { toEvalQuality } from "./eval-quality-metrics";
import { parseEvalCaseInput, parseEvalSetName } from "./eval-sets-parse";

describe("parseEvalSetName", () => {
  it("requires a non-empty name", () => {
    expect(parseEvalSetName("")).toEqual({ error: "Name is required." });
    expect(parseEvalSetName("   ")).toEqual({ error: "Name is required." });
  });

  it("trims a valid name", () => {
    expect(parseEvalSetName("  Refunds  ")).toEqual({ name: "Refunds" });
  });
});

describe("parseEvalCaseInput", () => {
  it("requires a question", () => {
    expect(parseEvalCaseInput({ question: "" })).toEqual({ error: "Question is required." });
  });

  it("treats blank expected answers as null", () => {
    expect(parseEvalCaseInput({ question: "What is the refund policy?", expectedAnswer: "  " })).toEqual({
      question: "What is the refund policy?",
      expectedAnswer: null,
    });
  });
});

describe("toEvalQuality", () => {
  it("rounds averages and recent low scores", () => {
    expect(
      toEvalQuality({
        averages: [
          { metric: "faithfulness", average: "0.8123" },
          { metric: "answerRelevance", average: null },
        ],
        lastRun: {
          id: "run-1",
          kind: "offline",
          status: "completed",
          createdAt: "2026-08-17T12:00:00.000Z",
          summary: { scoredCount: 8, averages: { faithfulness: 0.8 } },
        },
        failures: [
          {
            metric: "faithfulness",
            score: "0.21",
            kind: "online",
            createdAt: "2026-08-17T12:00:00.000Z",
          },
        ],
      }),
    ).toEqual({
      averages: { faithfulness: 0.812 },
      lastRun: {
        id: "run-1",
        kind: "offline",
        status: "completed",
        createdAt: "2026-08-17T12:00:00.000Z",
        summary: { scoredCount: 8, averages: { faithfulness: 0.8 } },
      },
      recentFailures: [
        {
          metric: "faithfulness",
          score: 0.21,
          kind: "online",
          createdAt: "2026-08-17T12:00:00.000Z",
        },
      ],
    });
  });
});
