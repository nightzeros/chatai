import { and, asc, conversations, desc, eq, inArray, messages, sql } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import {
  conversationSourceLabel,
  conversationVisitorLabel,
  toConversationListItem,
  toTranscriptMessages,
  type ConversationListSummary,
} from "@/lib/conversation-list";
import { db } from "@/lib/db";

const DEFAULT_LIST_LIMIT = 100;

async function listConversationsForAssistant(assistantId: string, limit = DEFAULT_LIST_LIMIT) {
  const rows = await db()
    .select({
      id: conversations.id,
      source: conversations.source,
      visitorId: conversations.visitorId,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.assistantId, assistantId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const summaries = await loadConversationSummaries(rows.map((row) => row.id));
  return rows.map((row) => toConversationListItem(row, summaries.get(row.id)));
}

export async function listOwnedConversations(userId: string, assistantId: string, limit = DEFAULT_LIST_LIMIT) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;
  return listConversationsForAssistant(assistant.id, limit);
}

export async function getOwnedConversationTranscript(
  userId: string,
  assistantId: string,
  conversationId: string,
) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const [conversation] = await db()
    .select({
      id: conversations.id,
      source: conversations.source,
      visitorId: conversations.visitorId,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.assistantId, assistantId)))
    .limit(1);

  if (!conversation) return null;

  const messageRows = await db()
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      role: messages.role,
      content: messages.content,
      sources: messages.sources,
      outcome: messages.outcome,
      feedback: messages.feedback,
      confidence: messages.confidence,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  return {
    conversation: {
      ...conversation,
      sourceLabel: conversationSourceLabel(conversation.source),
      visitorLabel: conversationVisitorLabel(conversation.source, conversation.visitorId),
    },
    messages: toTranscriptMessages(messageRows),
  };
}

async function loadConversationSummaries(conversationIds: string[]) {
  const summaries = new Map<string, ConversationListSummary>(
    conversationIds.map((id) => [
      id,
      { lastUserContent: null, lastOutcome: null, messageCount: 0 },
    ]),
  );

  const [counts, lastUsers, lastAssistants] = await Promise.all([
    db()
      .select({
        conversationId: messages.conversationId,
        messageCount: sql<number>`cast(count(*) as int)`,
      })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .groupBy(messages.conversationId),
    db()
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        content: messages.content,
      })
      .from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), eq(messages.role, "user")))
      .orderBy(messages.conversationId, desc(messages.createdAt)),
    db()
      .selectDistinctOn([messages.conversationId], {
        conversationId: messages.conversationId,
        outcome: messages.outcome,
      })
      .from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), eq(messages.role, "assistant")))
      .orderBy(messages.conversationId, desc(messages.createdAt)),
  ]);

  for (const row of counts) {
    const summary = summaries.get(row.conversationId);
    if (summary) summary.messageCount = Number(row.messageCount);
  }
  for (const row of lastUsers) {
    const summary = summaries.get(row.conversationId);
    if (summary) summary.lastUserContent = row.content;
  }
  for (const row of lastAssistants) {
    const summary = summaries.get(row.conversationId);
    if (summary) summary.lastOutcome = row.outcome ?? null;
  }

  return summaries;
}
