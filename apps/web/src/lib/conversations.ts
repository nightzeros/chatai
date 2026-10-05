import {
  and,
  asc,
  conversations,
  desc,
  eq,
  inArray,
  messages,
  sql,
  voiceRecordings,
  voiceSessions,
} from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import {
  classifyConversation,
  conversationSourceLabel,
  conversationVisitorLabel,
  toConversationListItem,
  toTranscriptMessages,
  type ConversationListSummary,
  type ConversationReviewListItem,
  type ConversationTypeFilter,
  type ConversationVoiceSummary,
} from "@/lib/conversation-list";
import { db } from "@/lib/db";

const DEFAULT_LIST_LIMIT = 100;

type SqlCondition = ReturnType<typeof sql>;

async function listConversationsForAssistant(
  assistantId: string,
  limit = DEFAULT_LIST_LIMIT,
  filter?: SqlCondition,
) {
  const rows = await db()
    .select({
      id: conversations.id,
      source: conversations.source,
      visitorId: conversations.visitorId,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(filter ? and(eq(conversations.assistantId, assistantId), filter) : eq(conversations.assistantId, assistantId))
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

/** Same rule as `classifyConversation`: a stored Voice turn or a stored Voice call. */
const hasVoiceSql = sql`(
  exists (select 1 from ${messages} where ${messages.conversationId} = ${conversations.id} and ${messages.modality} = 'voice')
  or exists (select 1 from ${voiceSessions} where ${voiceSessions.conversationId} = ${conversations.id} and ${voiceSessions.ephemeral} = false)
)`;

/**
 * Dashboard conversation list with Text/Voice/Mixed classification and the simple
 * type filter. The REST list keeps using `listOwnedConversations`.
 */
export async function listOwnedConversationReviewItems(
  userId: string,
  assistantId: string,
  filter: ConversationTypeFilter = "all",
  limit = DEFAULT_LIST_LIMIT,
): Promise<ConversationReviewListItem[] | null> {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;
  const where = filter === "voice" ? hasVoiceSql : filter === "text" ? sql`not ${hasVoiceSql}` : undefined;
  const items = await listConversationsForAssistant(assistant.id, limit, where);
  if (items.length === 0) return [];
  const voice = await loadVoiceSummaries(items.map((item) => item.id));
  return items.map((item) => ({ ...item, voice: voice.get(item.id)! }));
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
      modality: messages.modality,
      wasInterrupted: messages.wasInterrupted,
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

async function loadVoiceSummaries(conversationIds: string[]) {
  const counts = new Map(
    conversationIds.map((id) => [
      id,
      { textMessageCount: 0, voiceMessageCount: 0, voiceCallCount: 0, voiceDurationMs: 0, recordingCount: 0 },
    ]),
  );

  const [byModality, calls, recordings] = await Promise.all([
    db()
      .select({
        conversationId: messages.conversationId,
        modality: messages.modality,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), inArray(messages.role, ["user", "assistant"])))
      .groupBy(messages.conversationId, messages.modality),
    db()
      .select({
        conversationId: voiceSessions.conversationId,
        count: sql<number>`cast(count(*) as int)`,
        durationMs: sql<number>`cast(coalesce(sum(${voiceSessions.durationMs}), 0) as int)`,
      })
      .from(voiceSessions)
      .where(and(inArray(voiceSessions.conversationId, conversationIds), eq(voiceSessions.ephemeral, false)))
      .groupBy(voiceSessions.conversationId),
    db()
      .select({
        conversationId: voiceRecordings.conversationId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(voiceRecordings)
      .where(and(inArray(voiceRecordings.conversationId, conversationIds), eq(voiceRecordings.status, "ready")))
      .groupBy(voiceRecordings.conversationId),
  ]);

  for (const row of byModality) {
    const entry = counts.get(row.conversationId);
    if (!entry) continue;
    if (row.modality === "voice") entry.voiceMessageCount += Number(row.count);
    else entry.textMessageCount += Number(row.count);
  }
  for (const row of calls) {
    const entry = row.conversationId ? counts.get(row.conversationId) : undefined;
    if (!entry) continue;
    entry.voiceCallCount = Number(row.count);
    entry.voiceDurationMs = Number(row.durationMs);
  }
  for (const row of recordings) {
    const entry = row.conversationId ? counts.get(row.conversationId) : undefined;
    if (entry) entry.recordingCount = Number(row.count);
  }

  return new Map<string, ConversationVoiceSummary>(
    [...counts].map(([id, entry]) => [
      id,
      {
        kind: classifyConversation(entry),
        voiceCallCount: entry.voiceCallCount,
        voiceDurationMs: entry.voiceDurationMs,
        recordingCount: entry.recordingCount,
      },
    ]),
  );
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
