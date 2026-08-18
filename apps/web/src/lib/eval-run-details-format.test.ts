import { describe, expect, it } from "vitest";

import {
  caseLabel,
  formatCitationExplanation,
  formatExpectedAnswer,
  formatMetricExplanation,
  formatMetricLabel,
  formatMetricScore,
  hasUsefulRawDetails,
  isLowScore,
  runHasLowScores,
  runNeedsAttention,
} from "./eval-run-details-format";

describe("eval-run-details-format", () => {
  it("formats metric scores consistently", () => {
    expect(formatMetricScore(0.8123)).toBe("0.81");
  });

  it("labels cases from question text", () => {
    expect(caseLabel({ metrics: [], question: "Short question" }, 0)).toBe("Short question");
    expect(caseLabel({ metrics: [], caseId: "case-1234567890" }, 0)).toBe("Case case-123");
  });

  it("uses human metric labels", () => {
    expect(formatMetricLabel("contextRelevance")).toBe("Context relevance");
  });

  it("shows expected answer placeholder for offline cases", () => {
    expect(formatExpectedAnswer(null, true)).toBe("Not provided");
    expect(formatExpectedAnswer("30 days", true)).toBe("30 days");
  });

  it("prefers judge reason over raw json", () => {
    expect(
      formatMetricExplanation({
        metric: "contextRelevance",
        score: 0,
        reason: "Retrieved docs discuss billing, not refunds.",
      }),
    ).toBe("Retrieved docs discuss billing, not refunds.");
  });

  it("explains legacy llm metrics without reason", () => {
    expect(
      formatMetricExplanation({
        metric: "faithfulness",
        score: 1,
        details: { judge: "llm" },
      }),
    ).toMatch(/no judge explanation/i);
  });

  it("explains citation failures in plain language", () => {
    expect(formatCitationExplanation({ citations: [9], invalid: [9], maxIndex: 2 })).toMatch(/invalid citation/i);
  });

  it("hides raw json when only judge metadata is present", () => {
    expect(hasUsefulRawDetails({ judge: "llm" })).toBe(false);
    expect(hasUsefulRawDetails({ judge: "llm", invalid: [9] })).toBe(true);
  });

  it("flags low-scoring and failed runs", () => {
    expect(isLowScore(0.69)).toBe(true);
    expect(runHasLowScores({ status: "completed", summary: { averages: { contextRelevance: 0.2 } } })).toBe(true);
    expect(runNeedsAttention({ status: "failed", summary: null })).toBe(true);
  });
});
