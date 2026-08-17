import type { MessageOutcome } from "@chatai/database";

import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<MessageOutcome, string> = {
  answered_with_context: "Answered",
  fallback_no_context: "No context",
  low_confidence: "Low confidence",
  retrieval_failure: "Retrieval failed",
  model_failure: "Model failed",
  processing_failure: "Processing failed",
};

function outcomeTone(outcome: MessageOutcome) {
  if (outcome === "answered_with_context") return "text-emerald-700 dark:text-emerald-400";
  if (outcome === "low_confidence" || outcome === "fallback_no_context") {
    return "text-amber-700 dark:text-amber-400";
  }
  return "text-destructive";
}

export function OutcomeBadge({ outcome }: { outcome: MessageOutcome }) {
  return (
    <span className={cn("text-xs font-medium", outcomeTone(outcome))}>{OUTCOME_LABEL[outcome]}</span>
  );
}
