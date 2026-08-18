import type { RagGuardrails } from "@chatai/database";

import type { Decision } from "./decide";

export function applyGuardrails(
  decision: Decision,
  opts: { retrievedCount: number; guardrails?: RagGuardrails },
): Decision {
  const guardrails = opts.guardrails ?? {};
  let action = decision.action;

  if (guardrails.requireContext && (opts.retrievedCount === 0 || !decision.contextSufficient)) {
    action = "fallback";
  }

  if (guardrails.refuseOnLowConfidence && decision.confidence === "low") {
    action = "fallback";
  }

  return { ...decision, action };
}
