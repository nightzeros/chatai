import type { ProviderUsage } from "@chatai/ai";

/** One provider sub-call captured during a request (for metering / shadow logging). */
export type ProviderUsageRecord = {
  kind: "chat_completion" | "embedding" | "rerank";
  provider?: string;
  model?: string | null;
  usage: ProviderUsage;
  /** Free-form step label for debugging (rewrite, expand, answer, etc.). */
  step?: string;
};
