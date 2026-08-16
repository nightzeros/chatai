import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { documents } from "./documents";

export const ingestJobStatusEnum = pgEnum("ingest_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    status: ingestJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ingest_jobs_status_locked_at_idx").on(table.status, table.lockedAt),
    index("ingest_jobs_document_id_idx").on(table.documentId),
  ],
);

export const ingestJobsRelations = relations(ingestJobs, ({ one }) => ({
  document: one(documents, {
    fields: [ingestJobs.documentId],
    references: [documents.id],
  }),
}));
