import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  /** Small talk answered without retrieval. */
  "conversational",
  /** Follow-up answered from earlier grounded answers without new retrieval. */
  "answered_from_history",
  /** Request outside the assistant's purpose, redirected. Owner-visible only. */
  "out_of_scope",
]);

export const messageFeedbackEnum = pgEnum("message_feedback", ["positive", "negative"]);

export const messageModalityEnum = pgEnum("message_modality", ["text", "voice"]);

export type MessageOutcome = (typeof messageOutcomeEnum.enumValues)[number];
export type ConversationSource = (typeof conversationSourceEnum.enumValues)[number];
export type MessageModality = (typeof messageModalityEnum.enumValues)[number];

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
    /** text (default) or voice turn; existing rows remain text. */
    modality: messageModalityEnum("modality").notNull().default("text"),
    /** Assistant turn cut short by barge-in. */
    wasInterrupted: boolean("was_interrupted").notNull().default(false),
    /**
     * Optional link to voice_sessions. FK is applied in migration SQL to avoid
     * a circular TS import with voice.ts (which references conversations).
     */
    voiceSessionId: text("voice_session_id"),
    /**
     * Voice turn start in its call's recording (ms on the provider session timeline).
     * Review navigation only — never used for metering, quota or billing. Null for
     * text, legacy rows and turns without reliable timing.
     */
    audioOffsetMs: integer("audio_offset_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_conversation_id_created_at_idx").on(table.conversationId, table.createdAt),
    index("messages_voice_session_id_idx").on(table.voiceSessionId),
    check(
      "messages_audio_offset_ms_check",
      sql`${table.audioOffsetMs} IS NULL OR ${table.audioOffsetMs} >= 0`,
    ),
  ],
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
