import { describe, expect, it } from "vitest";

import { decide } from "./decide";
import { applyGuardrails } from "./guardrails";

describe("applyGuardrails", () => {
  it("forces fallback when requireContext is on and context is insufficient", () => {
    const decision = decide({ mode: "flexible", bestScore: 0.1, retrievedCount: 1 });
    expect(decision.action).toBe("generate");

    const guarded = applyGuardrails(decision, {
      retrievedCount: 1,
      guardrails: { requireContext: true },
    });
    expect(guarded.action).toBe("fallback");
  });

  it("forces fallback when refuseOnLowConfidence is on", () => {
    const decision = decide({ mode: "balanced", bestScore: 0.2, retrievedCount: 1 });
    expect(decision.confidence).toBe("low");

    const guarded = applyGuardrails(decision, {
      retrievedCount: 1,
      guardrails: { refuseOnLowConfidence: true },
    });
    expect(guarded.action).toBe("fallback");
  });

  it("leaves generate decisions alone when guardrails are off", () => {
    const decision = decide({ mode: "balanced", bestScore: 0.9, retrievedCount: 2 });
    const guarded = applyGuardrails(decision, {
      retrievedCount: 2,
      guardrails: {},
    });
    expect(guarded.action).toBe("generate");
  });
});
