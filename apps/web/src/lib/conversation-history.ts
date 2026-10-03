import { desc, eq, messages, type MessageOutcome } from "@chatai/database";
import type { ChatHistoryMessage } from "@chatai/rag/answer";
import { z } from "zod";

import { db } from "@/lib/db";

/**
 * Shared conversation-history semantics for text chat and Voice.
 *
 * Every persisted user/assistant message is history, whatever its modality and
 * whether or not retrieval ran for it. prepareAnswer applies the token window
 * (CONVERSATION_HISTORY_WINDOW); this limit only bounds the database read.
 */
export const CONVERSATION_HISTORY_LOAD_LIMIT = 40;

/** Assistant outcomes whose content came from the knowledge base (or was derived from it). */
const GROUNDED_OUTCOMES = new Set<MessageOutcome>(["answered_with_context", "answered_from_history"]);

/** Error placeholders are shown in the transcript but carry no conversational meaning. */
const FAILURE_OUTCOMES = new Set<MessageOutcome>(["model_failure", "processing_failure"]);

export function isGroundedOutcome(outcome: MessageOutcome | null | undefined): boolean {
  return Boolean(outcome && GROUNDED_OUTCOMES.has(outcome));
}

type HistoryRow = { role: string; content: string; outcome: MessageOutcome | null };

export function toHistoryMessages(rows: HistoryRow[]): ChatHistoryMessage[] {
  return rows.flatMap((row): ChatHistoryMessage[] => {
    if (row.role !== "user" && row.role !== "assistant") return [];
    if (!row.content.trim()) return [];
    if (row.role === "assistant" && row.outcome && FAILURE_OUTCOMES.has(row.outcome)) return [];
    return [
      {
        role: row.role,
        content: row.content,
        ...(row.role === "assistant" && isGroundedOutcome(row.outcome) ? { grounded: true } : {}),
        ...(row.role === "assistant" && row.outcome === "out_of_scope" ? { redirected: true } : {}),
      },
    ];
  });
}

export async function loadRecentConversationHistory(
  conversationId: string,
): Promise<ChatHistoryMessage[]> {
  const rows = await db()
    .select({ role: messages.role, content: messages.content, outcome: messages.outcome })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(CONVERSATION_HISTORY_LOAD_LIMIT);
  return toHistoryMessages(rows.reverse());
}

/**
 * Client-held history for conversations the server does not store (no-store) or
 * turns it never saw (ephemeral Voice). Never trusted as grounded.
 */
export const clientHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    }),
  )
  .max(CONVERSATION_HISTORY_LOAD_LIMIT);

/**
 * A client assistant turn counts as grounded only when it matches a grounded
 * answer the server stored for this conversation.
 */
export function withServerGrounding(
  client: ChatHistoryMessage[],
  stored: ChatHistoryMessage[],
): ChatHistoryMessage[] {
  const grounded = new Set(
    stored.filter((item) => item.grounded).map((item) => item.content.trim()),
  );
  return client.map((item) =>
    item.role === "assistant" && grounded.has(item.content.trim())
      ? { ...item, grounded: true }
      : item,
  );
}

export function fromClientHistory(
  items: z.infer<typeof clientHistorySchema> | undefined,
): ChatHistoryMessage[] {
  return (items ?? [])
    .filter((item) => item.content.trim())
    .map((item) => ({ role: item.role, content: item.content }));
}
