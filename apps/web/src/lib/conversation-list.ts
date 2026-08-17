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

export type ConversationDayGroup = {
  key: string;
  label: string;
  items: ConversationListItem[];
};

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: MessageSource[];
  outcome: MessageOutcome | null;
  feedback: "positive" | "negative" | null;
  confidence: number | null;
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

export function groupConversationsByDay(
  items: ConversationListItem[],
  now = new Date(),
  timeZone = "UTC",
): ConversationDayGroup[] {
  const groups = new Map<string, ConversationListItem[]>();

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
