/**
 * Text and Voice answer-owner rollout (independent flags).
 * Snapshot the resolved owner at turn creation; mid-turn env changes must not switch paths.
 */

/** Instance / env flag values. */
export type AnswerOwnerFlag = "legacy" | "agent" | "shadow_agent";
/** @deprecated Use AnswerOwnerFlag */
export type AnswerOwnerTextFlag = AnswerOwnerFlag;

/** Production path that delivers visitor/playground output and history. */
export type AnswerProductionPath = "legacy" | "agent";
/** @deprecated Use AnswerProductionPath */
export type TextAnswerPath = AnswerProductionPath;

export type ResolvedAnswerOwner = {
  production: AnswerProductionPath;
  /**
   * Run the tool-calling agent in addition to production legacy for comparison.
   * Never visitor-visible; never writes production history; never customer-charged.
   */
  shadowAgent: boolean;
};

/** @deprecated Use ResolvedAnswerOwner */
export type ResolvedTextAnswerOwner = ResolvedAnswerOwner;

export type ResolveAnswerOwnerInput = {
  answerOwner: AnswerOwnerFlag;
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

export type ResolveTextAnswerOwnerInput = {
  answerOwnerText: AnswerOwnerFlag;
  allowlistAssistantIds: string[];
  assistantId: string;
  visitor: boolean;
  visitorRelease: boolean;
};

function isAllowlisted(input: {
  allowlistAssistantIds: string[];
  assistantId: string;
}): boolean {
  if (input.allowlistAssistantIds.length === 0) return true;
  return input.allowlistAssistantIds.includes(input.assistantId);
}

export function resolveAnswerOwner(input: ResolveAnswerOwnerInput): ResolvedAnswerOwner {
  if (!isAllowlisted(input)) {
    return { production: "legacy", shadowAgent: false };
  }

  if (input.answerOwner === "shadow_agent") {
    // Production stays legacy; agent runs only for comparison / cost / quality metrics.
    return { production: "legacy", shadowAgent: true };
  }

  if (input.answerOwner !== "agent") {
    return { production: "legacy", shadowAgent: false };
  }

  // Production enablement blocked for visitors until evidence + Purpose checks are complete.
  if (input.visitor && !input.visitorRelease) {
    return { production: "legacy", shadowAgent: false };
  }
  return { production: "agent", shadowAgent: false };
}

export function resolveTextAnswerOwner(input: ResolveTextAnswerOwnerInput): ResolvedAnswerOwner {
  return resolveAnswerOwner({
    answerOwner: input.answerOwnerText,
    allowlistAssistantIds: input.allowlistAssistantIds,
    assistantId: input.assistantId,
    visitor: input.visitor,
    visitorRelease: input.visitorRelease,
  });
}

export function resolveVoiceAnswerOwner(input: {
  answerOwnerVoice: AnswerOwnerFlag;
  allowlistAssistantIds: string[];
  assistantId: string;
  visitor: boolean;
  visitorRelease: boolean;
}): ResolvedAnswerOwner {
  return resolveAnswerOwner({
    answerOwner: input.answerOwnerVoice,
    allowlistAssistantIds: input.allowlistAssistantIds,
    assistantId: input.assistantId,
    visitor: input.visitor,
    visitorRelease: input.visitorRelease,
  });
}

export function parseAssistantAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
