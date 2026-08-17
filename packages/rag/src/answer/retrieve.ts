import { and, chunks, cosineDistance, documents, eq, sql, type Database } from "@chatai/database";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  page?: number;
  heading?: string;
};

export async function retrieveChunks(opts: {
  db: Database;
  assistantId: string;
  embedding: number[];
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const distance = cosineDistance(chunks.embedding, opts.embedding);

  const rows = await opts.db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      metadata: chunks.metadata,
      documentName: documents.name,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(chunks.assistantId, opts.assistantId), eq(documents.excluded, false)))
    .orderBy(distance)
    .limit(opts.limit ?? 8);

  return rows.map((row) => {
    const metadata = row.metadata ?? {};
    return {
      chunkId: row.chunkId,
      documentId: row.documentId,
      documentName: row.documentName,
      content: row.content,
      similarity: Number(row.similarity ?? 0),
      ...(typeof metadata.page === "number" ? { page: metadata.page } : {}),
      ...(typeof metadata.heading === "string" ? { heading: metadata.heading } : {}),
    };
  });
}
