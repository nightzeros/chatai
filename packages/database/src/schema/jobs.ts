import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { documents } from "./documents";
import { sources } from "./sources";

export const ingestJobStatusEnum = pgEnum("ingest_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const ingestJobKindEnum = pgEnum("ingest_job_kind", ["ingest", "sync"]);

export type IngestJobKind = (typeof ingestJobKindEnum.enumValues)[number];

export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: text("id").primaryKey(),
    kind: ingestJobKindEnum("kind").notNull().default("ingest"),
    documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => sources.id, { onDelete: "cascade" }),
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
    index("ingest_jobs_source_id_idx").on(table.sourceId),
    check(
      "ingest_jobs_kind_keys",
      sql`(
        (${table.kind} = 'ingest' AND ${table.documentId} IS NOT NULL)
        OR (${table.kind} = 'sync' AND ${table.sourceId} IS NOT NULL)
      )`,
    ),
  ],
);

export const ingestJobsRelations = relations(ingestJobs, ({ one }) => ({
  document: one(documents, {
    fields: [ingestJobs.documentId],
    references: [documents.id],
  }),
  source: one(sources, {
    fields: [ingestJobs.sourceId],
    references: [sources.id],
  }),
}));
