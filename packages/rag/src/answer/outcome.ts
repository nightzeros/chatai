import type { MessageOutcome } from "@chatai/database";

import { extractCitationIndexes } from "./citations";

const UNSUPPORTED_CONTEXT_PATTERNS = [
  /sources(?:\s*\[\d+\])?\s+do not (include|contain)/i,
  /could(?: not|n't) find enough information/i,
  /knowledge base does not contain/i,
];

export function hasContextCitations(answer: string): boolean {
  return extractCitationIndexes(answer).length > 0;
}

export function isUnsupportedContextAnswer(answer: string, fallbackText: string): boolean {
  const trimmed = answer.trim();
  if (trimmed === fallbackText.trim()) {
    return true;
  }
  return UNSUPPORTED_CONTEXT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function resolveFinalOutcome(opts: {
  preparedOutcome: MessageOutcome;
  answer: string;
  fallbackText: string;
}): MessageOutcome {
  if (opts.preparedOutcome !== "answered_with_context") {
    return opts.preparedOutcome;
  }

  if (
    isUnsupportedContextAnswer(opts.answer, opts.fallbackText) ||
    !hasContextCitations(opts.answer)
  ) {
    return "fallback_no_context";
  }

  return "answered_with_context";
}
