import type { ProviderUsage } from "@chatai/ai";

/** One provider sub-call captured during a request (for metering / shadow logging). */
export type ProviderUsageRecord = {
  kind: "chat_completion" | "embedding" | "rerank" | "voice_realtime";
  provider?: string;
  model?: string | null;
  usage: ProviderUsage;
  /** Free-form step label for debugging (rewrite, expand, answer, etc.). */
  step?: string;
  /**
   * Stable id for this provider call. Late settlement and retries key on this:
   * the same eventId must not charge twice; distinct eventIds for one turn all apply.
   */
  eventId?: string;
};

/**
 * Called once per provider sub-call as soon as it completes, so callers can settle
 * usage that was already incurred when a later step throws.
 */
export type ProviderUsageListener = (record: ProviderUsageRecord) => void;
