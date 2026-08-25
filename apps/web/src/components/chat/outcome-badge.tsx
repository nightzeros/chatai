import { cn } from "@/lib/utils";

import type { MessageOutcome } from "@chatai/database";

const OUTCOME_LABEL: Record<MessageOutcome, string> = {
  answered_with_context: "Answered",
  fallback_no_context: "No context",
  low_confidence: "Low confidence",
  retrieval_failure: "Retrieval failed",
  model_failure: "Model failed",
  processing_failure: "Processing failed",
};

function outcomeClass(outcome: MessageOutcome) {
  if (outcome === "answered_with_context") return "text-success";
  if (outcome === "low_confidence" || outcome === "fallback_no_context") {
    return "text-warning-foreground";
  }
  return "text-destructive";
}

export function OutcomeBadge({ outcome }: { outcome: MessageOutcome }) {
  return <span className={cn("text-xs font-medium", outcomeClass(outcome))}>{OUTCOME_LABEL[outcome]}</span>;
}
