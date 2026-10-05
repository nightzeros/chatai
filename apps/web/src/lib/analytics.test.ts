import { describe, expect, it } from "vitest";

import {
  answerRate,
  isAnsweredOutcome,
  isConfidenceOutcome,
  isKnowledgeAnswerOutcome,
  isUnansweredOutcome,
  normalizeQuestion,
  toAnalyticsMetrics,
  toTopUnansweredQuestions,
} from "./analytics-metrics";

describe("analytics outcome semantics", () => {
  it("counts knowledge answers and history answers as answered, keeping them distinguishable", () => {
    expect(isAnsweredOutcome("answered_with_context")).toBe(true);
    expect(isAnsweredOutcome("answered_from_history")).toBe(true);
    expect(isKnowledgeAnswerOutcome("answered_with_context")).toBe(true);
    expect(isKnowledgeAnswerOutcome("answered_from_history")).toBe(false);
    expect(isAnsweredOutcome("low_confidence")).toBe(false);
    expect(isAnsweredOutcome("fallback_no_context")).toBe(false);
  });

  it("keeps small talk out of answered, unanswered and the answer rate", () => {
    expect(isAnsweredOutcome("conversational")).toBe(false);
    expect(isUnansweredOutcome("conversational")).toBe(false);
    expect(isConfidenceOutcome("conversational")).toBe(false);
    expect(answerRate(3, 1)).toBe(0.75);
    expect(answerRate(0, 0)).toBeNull();
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
        answeredWithContext: "4",
        answeredFromHistory: "1",
        unanswered: "2",
        conversational: "1",
        positiveFeedback: "4",
        negativeFeedback: "1",
        averageConfidence: "0.82354",
        averageResponseMs: "516.7",
      }),
    ).toEqual({
      totalConversations: 3,
      totalQuestions: 8,
      answered: 5,
      answeredWithContext: 4,
      answeredFromHistory: 1,
      unanswered: 2,
      conversational: 1,
      answerRate: 0.714,
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
        answeredWithContext: 0,
        answeredFromHistory: 0,
        unanswered: 0,
        conversational: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        averageConfidence: null,
        averageResponseMs: null,
      }),
    ).toMatchObject({
      totalConversations: 0,
      answerRate: null,
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
