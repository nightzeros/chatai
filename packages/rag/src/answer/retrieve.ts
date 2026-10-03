import {
  and,
  chunks,
  cosineDistance,
  documents,
  eq,
  inArray,
  sql,
  type Database,
} from "@chatai/database";

import { normalizeRrfScore, reciprocalRankFusion, RRF_K } from "./rrf";
import type { RetrieveFilters } from "./rag-settings";

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
  page?: number;
  heading?: string;
  parentContent?: string;
  url?: string;
  /** Owner-approved key fact supplied as background data (not a retrieval result). */
  keyFact?: boolean;
  /** Present when hybrid search fused vector + keyword ranks. */
  hybrid?: {
    vectorRank?: number;
    keywordRank?: number;
    rrfScore: number;
  };
  /** Present after reranking reorders retrieval candidates. */
  rerank?: {
    rank: number;
    priorRank: number;
    score?: number;
  };
};

export const HYBRID_CANDIDATE_LIMIT = 20;
export const VECTOR_ONLY_LIMIT = 8;

type ChunkRow = {
  chunkId: string;
  documentId: string;
  content: string;
  parentContent: string | null;
  metadata: Record<string, unknown> | null;
  documentName: string;
  documentUrl: string | null;
  similarity: number;
};

function mapChunkRow(row: ChunkRow): RetrievedChunk {
  const metadata = row.metadata ?? {};
  return {
    chunkId: row.chunkId,
    documentId: row.documentId,
    documentName: row.documentName,
    content: row.content,
    similarity: Number(row.similarity ?? 0),
    ...(row.documentUrl ? { url: row.documentUrl } : {}),
    ...(row.parentContent ? { parentContent: row.parentContent } : {}),
    ...(typeof metadata.page === "number" ? { page: metadata.page } : {}),
    ...(typeof metadata.heading === "string" ? { heading: metadata.heading } : {}),
  };
}

export function buildDocumentFilters(filters?: RetrieveFilters) {
  const conditions = [eq(documents.excluded, false)];

  if (filters?.documentIds?.length) {
    conditions.push(inArray(documents.id, filters.documentIds));
  }
  if (filters?.sourceId) {
    conditions.push(eq(documents.sourceId, filters.sourceId));
  }
  if (filters?.documentTypes?.length) {
    conditions.push(inArray(documents.type, filters.documentTypes));
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return and(...conditions);
}

async function retrieveVectorCandidates(opts: {
  db: Database;
  assistantId: string;
  embedding: number[];
  limit: number;
  filters?: RetrieveFilters;
}) {
  const distance = cosineDistance(chunks.embedding, opts.embedding);
  const documentFilters = buildDocumentFilters(opts.filters);

  const rows = await opts.db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      parentContent: chunks.parentContent,
      metadata: chunks.metadata,
      documentName: documents.name,
      documentUrl: documents.url,
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(chunks.assistantId, opts.assistantId), documentFilters))
    .orderBy(distance)
    .limit(opts.limit);

  return rows.map(mapChunkRow);
}

async function retrieveKeywordCandidates(opts: {
  db: Database;
  assistantId: string;
  query: string;
  limit: number;
  filters?: RetrieveFilters;
}) {
  const tsQuery = sql`plainto_tsquery('english', ${opts.query})`;
  const documentFilters = buildDocumentFilters(opts.filters);

  const rows = await opts.db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      content: chunks.content,
      parentContent: chunks.parentContent,
      metadata: chunks.metadata,
      documentName: documents.name,
      documentUrl: documents.url,
      similarity: sql<number>`ts_rank(${chunks.searchVector}, ${tsQuery})`,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      and(
        eq(chunks.assistantId, opts.assistantId),
        documentFilters,
        sql`${chunks.searchVector} @@ ${tsQuery}`,
      ),
    )
    .orderBy(sql`ts_rank(${chunks.searchVector}, ${tsQuery}) DESC`)
    .limit(opts.limit);

  return rows.map(mapChunkRow);
}

export function fuseHybridResults(
  vectorResults: RetrievedChunk[],
  keywordResults: RetrievedChunk[],
  limit: number,
) {
  const vectorRank = new Map(vectorResults.map((chunk, index) => [chunk.chunkId, index + 1]));
  const keywordRank = new Map(keywordResults.map((chunk, index) => [chunk.chunkId, index + 1]));

  const rrfScores = reciprocalRankFusion(
    [
      vectorResults.map((chunk) => ({ id: chunk.chunkId })),
      keywordResults.map((chunk) => ({ id: chunk.chunkId })),
    ],
    RRF_K,
  );

  const merged = new Map<string, RetrievedChunk>();
  for (const chunk of [...vectorResults, ...keywordResults]) {
    if (!merged.has(chunk.chunkId)) {
      merged.set(chunk.chunkId, chunk);
    }
  }

  const fused = [...merged.values()]
    .map((chunk) => {
      const rrfScore = rrfScores.get(chunk.chunkId) ?? 0;
      return {
        ...chunk,
        similarity: normalizeRrfScore(rrfScore, 2, RRF_K),
        hybrid: {
          vectorRank: vectorRank.get(chunk.chunkId),
          keywordRank: keywordRank.get(chunk.chunkId),
          rrfScore,
        },
      };
    })
    .sort((a, b) => (b.hybrid?.rrfScore ?? 0) - (a.hybrid?.rrfScore ?? 0))
    .slice(0, limit);

  return fused;
}

export function mergeRetrievalLists(lists: RetrievedChunk[][], limit: number) {
  if (lists.length === 0) {
    return [];
  }
  if (lists.length === 1) {
    return lists[0]!.slice(0, limit);
  }

  const rrfScores = reciprocalRankFusion(
    lists.map((list) => list.map((chunk) => ({ id: chunk.chunkId }))),
    RRF_K,
  );

  const merged = new Map<string, RetrievedChunk>();
  for (const list of lists) {
    for (const chunk of list) {
      if (!merged.has(chunk.chunkId)) {
        merged.set(chunk.chunkId, chunk);
      }
    }
  }

  return [...merged.values()]
    .map((chunk) => ({
      ...chunk,
      similarity: normalizeRrfScore(rrfScores.get(chunk.chunkId) ?? 0, lists.length, RRF_K),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function retrieveHybridChunks(opts: {
  db: Database;
  assistantId: string;
  embedding: number[];
  query: string;
  limit?: number;
  filters?: RetrieveFilters;
}) {
  const limit = opts.limit ?? HYBRID_CANDIDATE_LIMIT;
  const [vectorResults, keywordResults] = await Promise.all([
    retrieveVectorCandidates({
      db: opts.db,
      assistantId: opts.assistantId,
      embedding: opts.embedding,
      limit,
      filters: opts.filters,
    }),
    retrieveKeywordCandidates({
      db: opts.db,
      assistantId: opts.assistantId,
      query: opts.query,
      limit,
      filters: opts.filters,
    }),
  ]);

  return fuseHybridResults(vectorResults, keywordResults, limit);
}

export async function retrieveChunks(opts: {
  db: Database;
  assistantId: string;
  embedding: number[];
  query?: string;
  hybridSearch?: boolean;
  limit?: number;
  filters?: RetrieveFilters;
}): Promise<RetrievedChunk[]> {
  const hybridSearch = opts.hybridSearch ?? true;
  const query = opts.query?.trim();

  if (hybridSearch && query) {
    return retrieveHybridChunks({
      db: opts.db,
      assistantId: opts.assistantId,
      embedding: opts.embedding,
      query,
      limit: opts.limit ?? HYBRID_CANDIDATE_LIMIT,
      filters: opts.filters,
    });
  }

  return retrieveVectorCandidates({
    db: opts.db,
    assistantId: opts.assistantId,
    embedding: opts.embedding,
    limit: opts.limit ?? VECTOR_ONLY_LIMIT,
    filters: opts.filters,
  });
}
