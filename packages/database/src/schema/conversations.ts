import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";

export const conversationSourceEnum = pgEnum("conversation_source", [
  "playground",
  "widget",
  "api",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const messageOutcomeEnum = pgEnum("message_outcome", [
  "answered_with_context",
  "fallback_no_context",
  "low_confidence",
  "retrieval_failure",
  "model_failure",
  "processing_failure",
]);

export const messageFeedbackEnum = pgEnum("message_feedback", ["positive", "negative"]);

export type MessageOutcome = (typeof messageOutcomeEnum.enumValues)[number];
export type ConversationSource = (typeof conversationSourceEnum.enumValues)[number];

export type MessageSource = {
  documentId: string;
  documentName: string;
  chunkId?: string;
  page?: number;
  excerpt?: string;
};

export type MessageDebug = {
  question?: string;
  retrieval?: Array<{
    chunkId: string;
    documentId: string;
    documentName: string;
    similarity: number;
  }>;
  decision?: {
    contextSufficient: boolean;
    confidence: "high" | "medium" | "low";
    bestScore?: number;
    mode?: string;
    action?: string;
  };
  model?: string;
  latencyMs?: number;
  [key: string]: unknown;
};

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    /** Anonymous visitor token — not PII */
    visitorId: text("visitor_id"),
    source: conversationSourceEnum("source").notNull().default("playground"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversations_assistant_id_updated_at_idx").on(table.assistantId, table.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources").$type<MessageSource[]>().default([]),
    confidence: doublePrecision("confidence"),
    outcome: messageOutcomeEnum("outcome"),
    debug: jsonb("debug").$type<MessageDebug>(),
    feedback: messageFeedbackEnum("feedback"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("messages_conversation_id_created_at_idx").on(table.conversationId, table.createdAt)],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  assistant: one(assistants, {
    fields: [conversations.assistantId],
    references: [assistants.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));
