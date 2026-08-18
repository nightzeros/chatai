import { describe, expect, it } from "vitest";

import {
  isAnsweredOutcome,
  isConfidenceOutcome,
  isUnansweredOutcome,
  normalizeQuestion,
  toAnalyticsMetrics,
  toTopUnansweredQuestions,
} from "./analytics-metrics";

describe("analytics outcome semantics", () => {
  it("counts only context-backed answers as answered", () => {
    expect(isAnsweredOutcome("answered_with_context")).toBe(true);
    expect(isAnsweredOutcome("low_confidence")).toBe(false);
    expect(isAnsweredOutcome("fallback_no_context")).toBe(false);
  });

  it("treats fallback_no_context as an unanswered knowledge gap, not a successful answer", () => {
    expect(isAnsweredOutcome("fallback_no_context")).toBe(false);
    expect(isUnansweredOutcome("fallback_no_context")).toBe(true);
  });

  it("treats fallback and low-confidence answers as unanswered knowledge gaps", () => {
    expect(isUnansweredOutcome("fallback_no_context")).toBe(true);
    expect(isUnansweredOutcome("low_confidence")).toBe(true);
    expect(isUnansweredOutcome("retrieval_failure")).toBe(false);
    expect(isUnansweredOutcome("model_failure")).toBe(false);
    expect(isUnansweredOutcome(null)).toBe(false);
  });

  it("excludes hard failures from retrieval-confidence averages", () => {
    expect(isConfidenceOutcome("answered_with_context")).toBe(true);
    expect(isConfidenceOutcome("low_confidence")).toBe(true);
    expect(isConfidenceOutcome("fallback_no_context")).toBe(true);
    expect(isConfidenceOutcome("retrieval_failure")).toBe(false);
    expect(isConfidenceOutcome("model_failure")).toBe(false);
    expect(isConfidenceOutcome("processing_failure")).toBe(false);
  });
});

describe("normalizeQuestion", () => {
  it("collapses case, whitespace, and trailing punctuation for grouping", () => {
    expect(normalizeQuestion("  What is your refund policy?!  ")).toBe("what is your refund policy");
  });
});

describe("toAnalyticsMetrics", () => {
  it("converts aggregate counts and nullable averages into dashboard values", () => {
    expect(
      toAnalyticsMetrics({
        totalConversations: "3",
        totalQuestions: "8",
        answered: "5",
        unanswered: "2",
        positiveFeedback: "4",
        negativeFeedback: "1",
        averageConfidence: "0.82354",
        averageResponseMs: "516.7",
      }),
    ).toEqual({
      totalConversations: 3,
      totalQuestions: 8,
      answered: 5,
      unanswered: 2,
      positiveFeedback: 4,
      negativeFeedback: 1,
      averageConfidence: 0.824,
      averageResponseMs: 517,
    });
  });

  it("returns null averages when the assistant has no measured responses", () => {
    expect(
      toAnalyticsMetrics({
        totalConversations: 0,
        totalQuestions: 0,
        answered: 0,
        unanswered: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        averageConfidence: null,
        averageResponseMs: null,
      }),
    ).toMatchObject({
      totalConversations: 0,
      averageConfidence: null,
      averageResponseMs: null,
    });
  });
});

describe("toTopUnansweredQuestions", () => {
  it("groups normalized questions and keeps a readable display question", () => {
    expect(
      toTopUnansweredQuestions([
        { question: "What is your refund policy?", count: "2" },
        { question: "  what is your refund policy  ", count: 1 },
        { question: "Can I change my plan?", count: "3" },
      ]),
    ).toEqual([
      { question: "Can I change my plan?", count: 3 },
      { question: "What is your refund policy?", count: 3 },
    ]);
  });
});
