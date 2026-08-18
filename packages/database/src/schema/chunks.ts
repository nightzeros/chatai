import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  vector,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { documents } from "./documents";
import { tsvector } from "./pg-types";

export type ChunkMetadata = {
  page?: number;
  heading?: string;
  [key: string]: unknown;
};

/**
 * Embedding dimensions must match EMBEDDING_DIMENSIONS (default 1536).
 * Changing the embedding model later requires a full reprocess (v0.6).
 */
export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    metadata: jsonb("metadata").$type<ChunkMetadata>().notNull().default({}),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', "content")`,
    ),
    parentChunkId: text("parent_chunk_id").references((): AnyPgColumn => chunks.id, {
      onDelete: "set null",
    }),
    /** Denormalized parent passage used in prompts when a child chunk is retrieved. */
    parentContent: text("parent_content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chunks_assistant_id_idx").on(table.assistantId),
    index("chunks_document_id_idx").on(table.documentId),
    index("chunks_parent_chunk_id_idx").on(table.parentChunkId),
    index("chunks_embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),
    index("chunks_search_vector_gin_idx").using("gin", table.searchVector),
  ],
);

export const chunksRelations = relations(chunks, ({ one }) => ({
  document: one(documents, {
    fields: [chunks.documentId],
    references: [documents.id],
  }),
  assistant: one(assistants, {
    fields: [chunks.assistantId],
    references: [assistants.id],
  }),
  parentChunk: one(chunks, {
    fields: [chunks.parentChunkId],
    references: [chunks.id],
    relationName: "chunk_parent",
  }),
}));

/** Cosine distance helper for raw similarity queries (lower = more similar). */
export const cosineDistance = (column: typeof chunks.embedding, embedding: number[]) =>
  sql`${column} <=> ${JSON.stringify(embedding)}::vector`;
