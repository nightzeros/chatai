import type { ConversationSource } from "@chatai/database";

import { PrivacyPolicy, type PrivacyPolicyAssistant } from "../policies/privacy-policy";

/**
 * Decide whether chat transcripts (conversation + messages) should be written.
 * Always goes through PrivacyPolicy — do not duplicate rules in routes.
 */
export function shouldPersistChatTranscript(input: {
  assistant: PrivacyPolicyAssistant;
  source: ConversationSource;
  sessionUserId?: string | null;
  assistantOwnerId: string;
}): boolean {
  const privacy = PrivacyPolicy.fromAssistant(input.assistant);
  const isOwnerPlayground =
    input.source === "playground" && input.sessionUserId === input.assistantOwnerId;
  return privacy.shouldPersistConversation(input.source, isOwnerPlayground);
}
