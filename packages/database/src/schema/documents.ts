import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { sources } from "./sources";

export const documentTypeEnum = pgEnum("document_type", ["file", "text", "faq", "url"]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export type DocumentType = (typeof documentTypeEnum.enumValues)[number];

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "cascade" }),
    type: documentTypeEnum("type").notNull().default("file"),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    status: documentStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    /** Inline body for manual text / FAQ entries */
    content: text("content"),
    /** Relative/absolute path for uploaded files */
    storagePath: text("storage_path"),
    url: text("url"),
    contentHash: text("content_hash"),
    excluded: boolean("excluded").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("documents_source_id_url_uidx").on(table.sourceId, table.url)],
);

export const documentsRelations = relations(documents, ({ one }) => ({
  assistant: one(assistants, {
    fields: [documents.assistantId],
    references: [assistants.id],
  }),
  source: one(sources, {
    fields: [documents.sourceId],
    references: [sources.id],
  }),
}));
