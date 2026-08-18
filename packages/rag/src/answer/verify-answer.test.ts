import { describe, expect, it, vi } from "vitest";

import { FALLBACK_MESSAGE } from "./decide";
import {
  generateVerifiedAnswer,
  parseVerifierResponse,
  verifyAnswer,
  withVerifierResult,
} from "./verify-answer";
import type { PreparedAnswer } from "./answer";

function prepared(overrides: Partial<PreparedAnswer> = {}): PreparedAnswer {
  return {
    query: "What is the refund policy?",
    retrieved: [
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        documentName: "Policy",
        content: "Refunds are available within 30 days.",
        similarity: 0.9,
      },
    ],
    decision: {
      action: "generate",
      contextSufficient: true,
      confidence: "high",
      bestScore: 0.9,
      mode: "balanced",
    },
    outcome: "answered_with_context",
    confidence: 0.9,
    system: "You are a helpful assistant.",
    shouldGenerate: true,
    fallbackText: FALLBACK_MESSAGE,
    debug: {},
    ...overrides,
  };
}

describe("parseVerifierResponse", () => {
  it("parses JSON pass/fail verdicts", () => {
    expect(parseVerifierResponse('{"pass":true,"reason":"Supported."}')).toEqual({
      passed: true,
      reason: "Supported.",
    });
    expect(parseVerifierResponse('{"pass":false,"reason":"Unsupported claim."}')).toEqual({
      passed: false,
      reason: "Unsupported claim.",
    });
  });
});

describe("verifyAnswer", () => {
  it("fails invalid citation markers without calling the judge", async () => {
    const generateChat = vi.fn();
    const verdict = await verifyAnswer({
      question: "Refunds?",
      answer: "You can refund anytime [9].",
      context: "[1] Policy",
      retrievedCount: 1,
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      deps: { generateChat },
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("[9]");
    expect(generateChat).not.toHaveBeenCalled();
  });
});

describe("generateVerifiedAnswer", () => {
  it("accepts a passing answer without regenerating", async () => {
    const generateChat = vi
      .fn()
      .mockResolvedValueOnce("Refunds are available within 30 days [1].")
      .mockResolvedValueOnce('{"pass":true,"reason":"Supported by source 1."}');

    const result = await generateVerifiedAnswer({
      prepared: prepared(),
      question: "What is the refund policy?",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      deps: { generateChat },
    });

    expect(result.usedFallback).toBe(false);
    expect(result.verifier).toMatchObject({ passed: true, regenerated: false });
    expect(result.text).toContain("30 days");
    expect(generateChat).toHaveBeenCalledTimes(2);
  });

  it("regenerates once after a failed first verdict", async () => {
    const generateChat = vi
      .fn()
      .mockResolvedValueOnce("We offer lifetime refunds.")
      .mockResolvedValueOnce('{"pass":false,"reason":"Not in sources."}')
      .mockResolvedValueOnce("Refunds are available within 30 days [1].")
      .mockResolvedValueOnce('{"pass":true,"reason":"Retry is supported."}');

    const result = await generateVerifiedAnswer({
      prepared: prepared(),
      question: "What is the refund policy?",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      deps: { generateChat },
    });

    expect(result.verifier).toMatchObject({ passed: true, regenerated: true });
    expect(result.text).toContain("30 days");
    expect(generateChat).toHaveBeenCalledTimes(4);
  });

  it("falls back when the retry also fails verification", async () => {
    const generateChat = vi
      .fn()
      .mockResolvedValueOnce("Lifetime refunds.")
      .mockResolvedValueOnce('{"pass":false,"reason":"Unsupported."}')
      .mockResolvedValueOnce("Still unsupported.")
      .mockResolvedValueOnce('{"pass":false,"reason":"Still unsupported."}');

    const result = await generateVerifiedAnswer({
      prepared: prepared(),
      question: "What is the refund policy?",
      chat: { apiKey: "test", baseURL: "https://example.com/v1", model: "test" },
      deps: { generateChat },
    });

    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe(FALLBACK_MESSAGE);
    expect(result.verifier).toMatchObject({ passed: false, regenerated: true });

    const attached = withVerifierResult(prepared(), result);
    expect(attached.outcome).toBe("fallback_no_context");
    expect(attached.debug.verifier).toEqual(result.verifier);
  });
});
