"use server";

import { revalidatePath } from "next/cache";

import { logAuditEvent } from "@/lib/audit/log-audit-event";
import {
  deleteOwnedConversation,
  exportOwnedConversation,
} from "@/lib/privacy/conversation-lifecycle";
import { requireSession } from "@/lib/session";

export type ConversationActionState =
  | { error: string }
  | { deleted: true }
  | { exportJson: string; filename: string }
  | null;

export async function exportConversationAction(
  _prev: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  const session = await requireSession();
  const assistantId = String(formData.get("assistantId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");

  const exported = await exportOwnedConversation(session.user.id, assistantId, conversationId);
  if (!exported) {
    return { error: "Conversation not found." };
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "conversation_exported",
    resourceType: "conversation",
    resourceId: conversationId,
    metadata: { assistantId },
  });

  return {
    exportJson: JSON.stringify(exported, null, 2),
    filename: `conversation-${conversationId}.json`,
  };
}

export async function deleteConversationAction(
  _prev: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  const session = await requireSession();
  const assistantId = String(formData.get("assistantId") ?? "");
  const conversationId = String(formData.get("conversationId") ?? "");

  const result = await deleteOwnedConversation(session.user.id, assistantId, conversationId);
  if (!result.ok) {
    return { error: "Conversation not found." };
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "conversation_deleted",
    resourceType: "conversation",
    resourceId: conversationId,
    metadata: { assistantId },
  });

  revalidatePath(`/dashboard/assistants/${assistantId}/conversations`);
  return { deleted: true };
}
