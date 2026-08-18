import { describe, expect, it } from "vitest";

import { FALLBACK_MESSAGE } from "./thresholds";
import {
  hasContextCitations,
  isUnsupportedContextAnswer,
  resolveFinalOutcome,
} from "./outcome";

describe("hasContextCitations", () => {
  it("detects bracket citation markers", () => {
    expect(hasContextCitations("Refunds are available within 30 days [1].")).toBe(true);
    expect(hasContextCitations("The sources do not include a refund policy.")).toBe(false);
  });
});

describe("isUnsupportedContextAnswer", () => {
  it("matches the canned fallback message", () => {
    expect(isUnsupportedContextAnswer(FALLBACK_MESSAGE, FALLBACK_MESSAGE)).toBe(true);
  });

  it("matches generated refusals like the SDK smoke test", () => {
    expect(
      isUnsupportedContextAnswer(
        "I'm sorry, but the provided sources do not include information about a refund policy. You may want to contact the relevant business or organization directly for that information.",
        FALLBACK_MESSAGE,
      ),
    ).toBe(true);
  });

  it("matches cited refusals that still say the sources do not contain the answer", () => {
    expect(
      isUnsupportedContextAnswer(
        "The sources [1] do not include a refund policy.",
        FALLBACK_MESSAGE,
      ),
    ).toBe(true);
  });

  it("does not treat a grounded answer as unsupported", () => {
    expect(
      isUnsupportedContextAnswer("Refunds are available within 30 days [1].", FALLBACK_MESSAGE),
    ).toBe(false);
  });
});

describe("resolveFinalOutcome", () => {
  it("keeps answered_with_context when the model cites retrieved sources", () => {
    expect(
      resolveFinalOutcome({
        preparedOutcome: "answered_with_context",
        answer: "Refunds are available within 30 days [1].",
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("answered_with_context");
  });

  it("demotes retrieved-but-unsupported refusals to fallback_no_context", () => {
    expect(
      resolveFinalOutcome({
        preparedOutcome: "answered_with_context",
        answer:
          "I'm sorry, but the provided sources do not include information about a refund policy.",
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("fallback_no_context");
  });

  it("demotes uncited answered_with_context answers", () => {
    expect(
      resolveFinalOutcome({
        preparedOutcome: "answered_with_context",
        answer: "Refunds are available within 30 days.",
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("fallback_no_context");
  });

  it("demotes cited refusals that say the sources do not contain the answer", () => {
    expect(
      resolveFinalOutcome({
        preparedOutcome: "answered_with_context",
        answer: "The sources [1] do not include a refund policy.",
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("fallback_no_context");
  });

  it("leaves existing non-answered outcomes unchanged", () => {
    expect(
      resolveFinalOutcome({
        preparedOutcome: "low_confidence",
        answer: "Here is a general overview without citations.",
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("low_confidence");
    expect(
      resolveFinalOutcome({
        preparedOutcome: "fallback_no_context",
        answer: FALLBACK_MESSAGE,
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("fallback_no_context");
    expect(
      resolveFinalOutcome({
        preparedOutcome: "retrieval_failure",
        answer: FALLBACK_MESSAGE,
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("retrieval_failure");
    expect(
      resolveFinalOutcome({
        preparedOutcome: "model_failure",
        answer: "I ran into a problem generating a response. Please try again.",
        fallbackText: FALLBACK_MESSAGE,
      }),
    ).toBe("model_failure");
  });
});
