/**
 * Text answer-owner rollout. Voice has a separate flag (not used in this slice).
 * Snapshot the resolved owner at turn creation; mid-turn env changes must not switch paths.
 */

export type AnswerOwnerText = "legacy" | "agent";

export type ResolveTextAnswerOwnerInput = {
  /** Instance default: legacy | agent */
  answerOwnerText: AnswerOwnerText;
  /** When non-empty, only these assistant ids may use agent. */
  allowlistAssistantIds: string[];
  assistantId: string;
  visitor: boolean;
  /**
   * Must stay false until evidence Layers B/C and Purpose checks pass acceptance.
   * Visitors never receive the agent path while this is false.
   */
  visitorRelease: boolean;
};

export function resolveTextAnswerOwner(input: ResolveTextAnswerOwnerInput): AnswerOwnerText {
  if (input.answerOwnerText !== "agent") return "legacy";
  if (
    input.allowlistAssistantIds.length > 0 &&
    !input.allowlistAssistantIds.includes(input.assistantId)
  ) {
    return "legacy";
  }
  // Production enablement blocked until evidence + Purpose checks are complete.
  if (input.visitor && !input.visitorRelease) return "legacy";
  return "agent";
}

export function parseAssistantAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
