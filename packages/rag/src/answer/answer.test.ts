import { describe, expect, it } from "vitest";

import { finalizeAnswer, type PreparedAnswer } from "./answer";
import { FALLBACK_MESSAGE } from "./thresholds";
import { withVerifierResult } from "./verify-answer";

const policyChunk = {
  chunkId: "chunk-1",
  documentId: "doc-1",
  documentName: "Policy",
  content: "Refunds are available within 30 days.",
  similarity: 0.9,
};

function prepared(overrides: Partial<PreparedAnswer> = {}): PreparedAnswer {
  return {
    query: "What is your refund policy?",
    retrieved: [policyChunk],
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

describe("finalizeAnswer outcome classification", () => {
  it("keeps answered_with_context when retrieved context supports a cited answer", () => {
    const result = finalizeAnswer("Refunds are available within 30 days [1].", prepared());

    expect(result.outcome).toBe("answered_with_context");
    expect(result.sources).toEqual([
      expect.objectContaining({ documentId: "doc-1", documentName: "Policy" }),
    ]);
  });

  it("classifies retrieved-but-unsupported refusals as fallback_no_context", () => {
    const result = finalizeAnswer(
      "I'm sorry, but the provided sources do not include information about a refund policy. You may want to contact the relevant business or organization directly for that information.",
      prepared(),
    );

    expect(result.outcome).toBe("fallback_no_context");
    expect(result.sources).toEqual([]);
  });

  it("classifies canned fallback after skipped generation as fallback_no_context", () => {
    const result = finalizeAnswer(FALLBACK_MESSAGE, prepared({
      outcome: "fallback_no_context",
      decision: {
        action: "fallback",
        contextSufficient: false,
        confidence: "low",
        bestScore: 0,
        mode: "strict",
      },
      retrieved: [],
      shouldGenerate: false,
    }));

    expect(result.outcome).toBe("fallback_no_context");
    expect(result.sources).toEqual([]);
  });

  it("keeps low_confidence when no useful context was retrieved and the model still generated", () => {
    const result = finalizeAnswer("I can give a general overview, but I do not have a policy document.", prepared({
      outcome: "low_confidence",
      retrieved: [],
      decision: {
        action: "generate",
        contextSufficient: false,
        confidence: "low",
        bestScore: 0,
        mode: "balanced",
      },
      confidence: 0,
    }));

    expect(result.outcome).toBe("low_confidence");
  });

  it("does not remap retrieval_failure or model_failure", () => {
    expect(finalizeAnswer(FALLBACK_MESSAGE, prepared({ outcome: "retrieval_failure" })).outcome).toBe(
      "retrieval_failure",
    );
    expect(
      finalizeAnswer("I ran into a problem generating a response. Please try again.", prepared({
        outcome: "model_failure",
      })).outcome,
    ).toBe("model_failure");
  });

  it("does not attach retrieved chunks when the model refused despite pre-assigned answered_with_context", () => {
    const result = finalizeAnswer(
      "The sources do not contain a refund policy.",
      prepared({ outcome: "answered_with_context" }),
    );

    expect(result.outcome).toBe("fallback_no_context");
    expect(result.sources).toEqual([]);
  });

  it("keeps verifier fallback as fallback_no_context", () => {
    const attached = withVerifierResult(prepared(), {
      text: FALLBACK_MESSAGE,
      usedFallback: true,
      verifier: { enabled: true, passed: false, reason: "Unsupported.", regenerated: true },
    });

    const result = finalizeAnswer(attached.fallbackText, attached);
    expect(result.outcome).toBe("fallback_no_context");
    expect(result.sources).toEqual([]);
  });
});
