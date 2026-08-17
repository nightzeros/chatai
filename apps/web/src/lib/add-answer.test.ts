import { describe, expect, it } from "vitest";

import { buildFaqPayload } from "./add-answer";

describe("buildFaqPayload", () => {
  it("trims question and answer before sending them to FAQ ingestion", () => {
    expect(buildFaqPayload("  What is your refund policy?  ", "  Refunds are available for 30 days.  ")).toEqual({
      question: "What is your refund policy?",
      answer: "Refunds are available for 30 days.",
    });
  });

  it("rejects blank or overlong values before submitting", () => {
    expect(buildFaqPayload(" ", "An answer")).toEqual({ error: "A question is required." });
    expect(buildFaqPayload("Question", " ")).toEqual({ error: "An answer is required." });
    expect(buildFaqPayload("q".repeat(501), "Answer")).toEqual({
      error: "Questions must be 500 characters or fewer.",
    });
    expect(buildFaqPayload("Question", "a".repeat(20_001))).toEqual({
      error: "Answers must be 20,000 characters or fewer.",
    });
  });

  it("accepts values at the FAQ endpoint limits", () => {
    expect(buildFaqPayload("q".repeat(500), "a".repeat(20_000))).toEqual({
      question: "q".repeat(500),
      answer: "a".repeat(20_000),
    });
  });
});
