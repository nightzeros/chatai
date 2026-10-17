/**
 * Text answer-owner rollout. Voice has a separate flag (not used in this slice).
 * Snapshot the resolved owner at turn creation; mid-turn env changes must not switch paths.
 */

/** Instance / env flag values. */
export type AnswerOwnerTextFlag = "legacy" | "agent" | "shadow_agent";

/** Production path that delivers visitor/playground output and history. */
export type TextAnswerPath = "legacy" | "agent";

export type ResolvedTextAnswerOwner = {
  production: TextAnswerPath;
  /**
   * Run the tool-calling agent in addition to production legacy for comparison.
   * Never visitor-visible; never writes production history; never customer-charged.
   */
  shadowAgent: boolean;
};

export type ResolveTextAnswerOwnerInput = {
  answerOwnerText: AnswerOwnerTextFlag;
  /** When non-empty, only these assistant ids may use agent or shadow_agent. */
  allowlistAssistantIds: string[];
  assistantId: string;
  visitor: boolean;
  /**
   * Must stay false until evidence Layers B/C and Purpose checks pass acceptance.
   * Visitors never receive the agent path while this is false.
   */
  visitorRelease: boolean;
};

function isAllowlisted(input: ResolveTextAnswerOwnerInput): boolean {
  if (input.allowlistAssistantIds.length === 0) return true;
  return input.allowlistAssistantIds.includes(input.assistantId);
}

export function resolveTextAnswerOwner(input: ResolveTextAnswerOwnerInput): ResolvedTextAnswerOwner {
  if (!isAllowlisted(input)) {
    return { production: "legacy", shadowAgent: false };
  }

  if (input.answerOwnerText === "shadow_agent") {
    // Production stays legacy; agent runs only for comparison / cost / quality metrics.
    return { production: "legacy", shadowAgent: true };
  }

  if (input.answerOwnerText !== "agent") {
    return { production: "legacy", shadowAgent: false };
  }

  // Production enablement blocked for visitors until evidence + Purpose checks are complete.
  if (input.visitor && !input.visitorRelease) {
    return { production: "legacy", shadowAgent: false };
  }
  return { production: "agent", shadowAgent: false };
}

export function parseAssistantAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
