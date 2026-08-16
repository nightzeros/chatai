import { relations } from "drizzle-orm";
import {
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";

export const documentTypeEnum = pgEnum("document_type", ["file", "text", "faq"]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  assistantId: text("assistant_id")
    .notNull()
    .references(() => assistants.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentsRelations = relations(documents, ({ one }) => ({
  assistant: one(assistants, {
    fields: [documents.assistantId],
    references: [assistants.id],
  }),
}));
