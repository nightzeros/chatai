import type { ConversationSource, MessageOutcome, MessageSource } from "@chatai/database";

export const CONVERSATION_PREVIEW_MAX = 80;

export type ConversationListRecord = {
  id: string;
  source: ConversationSource;
  visitorId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationMessageRecord = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: MessageSource[] | null;
  outcome?: MessageOutcome | null;
  debug?: unknown;
  feedback?: "positive" | "negative" | null;
  confidence?: number | null;
  modality?: "text" | "voice";
  wasInterrupted?: boolean;
  createdAt: Date;
};

export type ConversationListItem = {
  id: string;
  source: ConversationSource;
  sourceLabel: string;
  visitorLabel: string;
  preview: string;
  outcome: MessageOutcome | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationDayGroup<T extends ConversationListItem = ConversationListItem> = {
  key: string;
  label: string;
  items: T[];
};

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: MessageSource[];
  outcome: MessageOutcome | null;
  feedback: "positive" | "negative" | null;
  confidence: number | null;
  modality: "text" | "voice";
  wasInterrupted: boolean;
  createdAt: Date;
};

const SOURCE_LABEL: Record<ConversationSource, string> = {
  playground: "Playground",
  widget: "Widget",
  api: "API",
};

export function truncatePreview(text: string, max = CONVERSATION_PREVIEW_MAX) {
  const collapsed = text.trim().replace(/\s+/g, " ");
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function conversationSourceLabel(source: ConversationSource) {
  return SOURCE_LABEL[source];
}

export function conversationVisitorLabel(source: ConversationSource, visitorId: string | null) {
  if (source === "playground") return "Playground";
  if (!visitorId) return "Anonymous";
  const suffix = visitorId.slice(-6);
  return `…${suffix}`;
}

/** Owner-facing classification: Text only, Voice only, or both. */
export type ConversationKind = "text" | "voice" | "mixed";

/** Conversation list filter; `voice` includes Mixed conversations. */
export type ConversationTypeFilter = "all" | "text" | "voice";

export type ConversationVoiceSummary = {
  kind: ConversationKind;
  voiceCallCount: number;
  voiceDurationMs: number;
  recordingCount: number;
};

export type ConversationReviewListItem = ConversationListItem & { voice: ConversationVoiceSummary };

/**
 * A conversation has Voice when it has stored Voice turns or a stored Voice call
 * (calls with transcripts off have no turns); Text when it has text messages.
 */
export function classifyConversation(counts: {
  textMessageCount: number;
  voiceMessageCount: number;
  voiceCallCount: number;
}): ConversationKind {
  const hasVoice = counts.voiceMessageCount > 0 || counts.voiceCallCount > 0;
  if (hasVoice && counts.textMessageCount > 0) return "mixed";
  return hasVoice ? "voice" : "text";
}

export function parseConversationTypeFilter(value: unknown): ConversationTypeFilter {
  return value === "text" || value === "voice" ? value : "all";
}

export function matchesConversationFilter(kind: ConversationKind, filter: ConversationTypeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "voice") return kind === "voice" || kind === "mixed";
  return kind === "text";
}

export type ConversationListSummary = {
  lastUserContent: string | null;
  lastOutcome: MessageOutcome | null;
  messageCount: number;
};

export function toConversationListItem(
  conversation: ConversationListRecord,
  summary: ConversationListSummary = {
    lastUserContent: null,
    lastOutcome: null,
    messageCount: 0,
  },
): ConversationListItem {
  return {
    id: conversation.id,
    source: conversation.source,
    sourceLabel: conversationSourceLabel(conversation.source),
    visitorLabel: conversationVisitorLabel(conversation.source, conversation.visitorId),
    preview: summary.lastUserContent ? truncatePreview(summary.lastUserContent) : "No messages yet",
    outcome: summary.lastOutcome,
    messageCount: summary.messageCount,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export function buildConversationListItems(
  conversations: ConversationListRecord[],
  messages: ConversationMessageRecord[],
): ConversationListItem[] {
  const messagesByConversation = new Map<string, ConversationMessageRecord[]>();
  for (const row of messages) {
    const list = messagesByConversation.get(row.conversationId) ?? [];
    list.push(row);
    messagesByConversation.set(row.conversationId, list);
  }

  return conversations.map((conversation) => {
    const rows = (messagesByConversation.get(conversation.id) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const lastUser = [...rows].reverse().find((row) => row.role === "user");
    const lastAssistant = [...rows].reverse().find((row) => row.role === "assistant");

    return toConversationListItem(conversation, {
      lastUserContent: lastUser?.content ?? null,
      lastOutcome: lastAssistant?.outcome ?? null,
      messageCount: rows.length,
    });
  });
}

export function groupConversationsByDay<T extends ConversationListItem>(
  items: T[],
  now = new Date(),
  timeZone = "UTC",
): ConversationDayGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = dayKey(item.updatedAt, timeZone);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([key, groupItems]) => ({
    key,
    label: dayLabel(key, now, timeZone),
    items: groupItems,
  }));
}

export function toTranscriptMessages(messages: ConversationMessageRecord[]): TranscriptMessage[] {
  return messages
    .filter((row): row is ConversationMessageRecord & { role: "user" | "assistant" } => row.role !== "system")
    .map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      sources: row.sources ?? [],
      outcome: row.outcome ?? null,
      feedback: row.feedback ?? null,
      confidence: row.confidence ?? null,
      modality: row.modality ?? "text",
      wasInterrupted: row.wasInterrupted ?? false,
      createdAt: row.createdAt,
    }));
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayLabel(key: string, now: Date, timeZone: string) {
  const today = dayKey(now, timeZone);
  if (key === today) return "Today";
  if (key === shiftDayKey(today, -1)) return "Yesterday";

  const [year, month, day] = key.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, 12));
  return new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(noonUtc);
}

function shiftDayKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}
