import {
  and,
  asc,
  conversations,
  eq,
  inArray,
  messages,
  or,
  voiceRecordings,
  voiceSessions,
} from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { conversationSourceLabel, conversationVisitorLabel } from "@/lib/conversation-list";
import { buildConversationTimeline, type TimelineEntry } from "@/lib/conversation-timeline";
import { db } from "@/lib/db";
import { toVoiceRecordingView } from "@/lib/voice/recording/playback";

export type ConversationReview = {
  conversation: {
    id: string;
    sourceLabel: string;
    visitorLabel: string;
    createdAt: Date;
    updatedAt: Date;
  };
  entries: TimelineEntry[];
};

/**
 * Owner review of one conversation: text turns, Voice calls (with their turns and
 * recording) in order. Dashboard only — the REST transcript shape is unchanged.
 * No-store Voice sessions are never attached to a conversation, so they never appear.
 */
export async function getOwnedConversationReview(
  userId: string,
  assistantId: string,
  conversationId: string,
): Promise<ConversationReview | null> {
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
    .where(and(eq(conversations.id, conversationId), eq(conversations.assistantId, assistant.id)))
    .limit(1);
  if (!conversation) return null;

  const [messageRows, recordingRows] = await Promise.all([
    db()
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sources: messages.sources,
        outcome: messages.outcome,
        feedback: messages.feedback,
        confidence: messages.confidence,
        modality: messages.modality,
        wasInterrupted: messages.wasInterrupted,
        voiceSessionId: messages.voiceSessionId,
        audioOffsetMs: messages.audioOffsetMs,
        latencyMs: messages.latencyMs,
        debug: messages.debug,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(asc(messages.createdAt)),
    db()
      .select({
        id: voiceRecordings.id,
        sessionId: voiceRecordings.sessionId,
        status: voiceRecordings.status,
        partial: voiceRecordings.partial,
        durationMs: voiceRecordings.durationMs,
        createdAt: voiceRecordings.createdAt,
        expiresAt: voiceRecordings.expiresAt,
        deletedAt: voiceRecordings.deletedAt,
        timelineVersion: voiceRecordings.timelineVersion,
      })
      .from(voiceRecordings)
      .where(eq(voiceRecordings.conversationId, conversation.id)),
  ]);

  const linkedSessionIds = [
    ...new Set([
      ...messageRows.flatMap((row) => (row.voiceSessionId ? [row.voiceSessionId] : [])),
      ...recordingRows.map((row) => row.sessionId),
    ]),
  ];
  const callRows = await db()
    .select({
      id: voiceSessions.id,
      source: voiceSessions.source,
      status: voiceSessions.status,
      startedAt: voiceSessions.startedAt,
      endedAt: voiceSessions.endedAt,
      durationMs: voiceSessions.durationMs,
      errorCode: voiceSessions.errorCode,
      interruptCount: voiceSessions.interruptCount,
      voiceSeconds: voiceSessions.voiceSeconds,
      meteringStatus: voiceSessions.meteringStatus,
      quotaExempt: voiceSessions.quotaExempt,
    })
    .from(voiceSessions)
    .where(
      and(
        eq(voiceSessions.assistantId, assistant.id),
        eq(voiceSessions.ephemeral, false),
        linkedSessionIds.length > 0
          ? or(
              eq(voiceSessions.conversationId, conversation.id),
              inArray(voiceSessions.id, linkedSessionIds),
            )
          : eq(voiceSessions.conversationId, conversation.id),
      ),
    );

  const recordings = recordingRows.flatMap((row) => {
    const view = toVoiceRecordingView(row);
    return view ? [{ ...view, sessionId: row.sessionId }] : [];
  });

  return {
    conversation: {
      id: conversation.id,
      sourceLabel: conversationSourceLabel(conversation.source),
      visitorLabel: conversationVisitorLabel(conversation.source, conversation.visitorId),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    },
    entries: buildConversationTimeline({ messages: messageRows, calls: callRows, recordings }),
  };
}
