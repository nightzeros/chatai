import { and, conversations, eq } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { getOwnedConversationTranscript } from "@/lib/conversations";
import { db } from "@/lib/db";
import { buildConversationExport } from "./conversation-export";

export async function exportOwnedConversation(
  userId: string,
  assistantId: string,
  conversationId: string,
) {
  const transcript = await getOwnedConversationTranscript(userId, assistantId, conversationId);
  if (!transcript) {
    return null;
  }

  return buildConversationExport({
    assistantId,
    conversation: {
      id: transcript.conversation.id,
      source: transcript.conversation.source,
      visitorId: transcript.conversation.visitorId,
      createdAt: transcript.conversation.createdAt,
      updatedAt: transcript.conversation.updatedAt,
    },
    messages: transcript.messages,
  });
}

export async function deleteOwnedConversation(
  userId: string,
  assistantId: string,
  conversationId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) {
    return { ok: false, reason: "not_found" };
  }

  const deleted = await db()
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.assistantId, assistant.id)))
    .returning({ id: conversations.id });

  if (deleted.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  return { ok: true };
}
