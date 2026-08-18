import type { MessageDebug, MessageSource } from "@chatai/database";
import type { RetrievedChunk } from "@chatai/rag/answer";
import { uniqueContextChunks } from "@chatai/rag/answer";

import type { EvalCaseSnapshot, EvalCitationMapping, EvalRetrievalSnapshot } from "./eval-snapshot";

type ParsedContextBlock = {
  index: number;
  documentName: string;
  content: string;
  page?: number;
};

type DebugRetrievalItem = NonNullable<MessageDebug["retrieval"]>[number];

export function contextChunksForEval(chunks: RetrievedChunk[]): RetrievedChunk[] {
  return uniqueContextChunks(chunks);
}

export function toEvalDebugRetrieval(chunks: RetrievedChunk[]): DebugRetrievalItem[] {
  return chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    similarity: Number(chunk.similarity.toFixed(4)),
  }));
}

export function parseContextBlocks(context?: string): ParsedContextBlock[] {
  if (!context?.trim() || context.includes("(No knowledge base passages were retrieved.)")) {
    return [];
  }

  return context
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const match = block.match(/^\[(\d+)\]\s*([^\n]+)\n([\s\S]*)$/);
      if (!match) return null;

      const index = Number(match[1]);
      const header = match[2]?.trim() ?? "";
      const content = match[3]?.trim() ?? "";
      const pageMatch = header.match(/^(.+?),\s*page\s+(\d+)$/);

      if (pageMatch) {
        return {
          index,
          documentName: pageMatch[1]!.trim(),
          page: Number(pageMatch[2]),
          content,
        };
      }

      return {
        index,
        documentName: header,
        content,
      };
    })
    .filter((block): block is ParsedContextBlock => block !== null && Number.isInteger(block.index) && block.index > 0)
    .sort((a, b) => a.index - b.index);
}

function extractCitationIndexes(answer: string): number[] {
  const indexes = new Set<number>();
  const pattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) !== null) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) {
      indexes.add(value);
    }
  }
  return [...indexes].sort((a, b) => a - b);
}

function buildCitationMappings(answer: string, retrieval: EvalRetrievalSnapshot[]): EvalCitationMapping[] {
  return extractCitationIndexes(answer).map((marker) => {
    const chunk = retrieval.find((item) => item.index === marker) ?? retrieval[marker - 1];
    return {
      marker,
      chunkId: chunk?.chunkId,
      documentId: chunk?.documentId,
      documentName: chunk?.documentName,
      ...(chunk?.url ? { url: chunk.url } : {}),
    };
  });
}

function sourceForDocument(sources: MessageSource[], documentId?: string, documentName?: string) {
  return sources.find(
    (source) =>
      (documentId && source.documentId === documentId) ||
      (documentName && source.documentName === documentName),
  );
}

function retrievalFromDebug(
  debugItems: DebugRetrievalItem[],
  sources: MessageSource[],
): EvalRetrievalSnapshot[] {
  return debugItems.map((item, index) => {
    const source = sourceForDocument(sources, item.documentId, item.documentName);
    return {
      index: index + 1,
      chunkId: item.chunkId,
      documentId: item.documentId,
      documentName: item.documentName,
      similarity: item.similarity,
      content: source?.excerpt ?? "",
      ...(source?.page !== undefined ? { page: source.page } : {}),
    };
  });
}

function mergeParsedContextWithDebug(
  parsed: ParsedContextBlock[],
  debugItems: DebugRetrievalItem[],
  sources: MessageSource[],
): EvalRetrievalSnapshot[] {
  return parsed.map((block) => {
    const debugItem = debugItems[block.index - 1];
    const source = sourceForDocument(sources, debugItem?.documentId, block.documentName);
    return {
      index: block.index,
      chunkId: debugItem?.chunkId ?? source?.chunkId ?? `context-${block.index}`,
      documentId: debugItem?.documentId ?? source?.documentId ?? `context-doc-${block.index}`,
      documentName: block.documentName,
      similarity: debugItem?.similarity ?? 0,
      content: block.content,
      ...(block.page !== undefined ? { page: block.page } : {}),
    };
  });
}

function retrievalFromStoredChunks(stored: EvalRetrievalSnapshot[] | undefined): EvalRetrievalSnapshot[] {
  if (!stored?.length) return [];
  return stored.map((chunk, index) => ({
    ...chunk,
    index: chunk.index ?? index + 1,
  }));
}

export function enrichEvalCaseSnapshot(snapshot: EvalCaseSnapshot): EvalCaseSnapshot {
  const stored = retrievalFromStoredChunks(snapshot.retrieval);
  if (stored.length > 0) {
    return {
      ...snapshot,
      retrieval: stored,
      citations: buildCitationMappings(snapshot.answer, stored),
    };
  }

  const parsed = parseContextBlocks(snapshot.context);
  const debugItems = snapshot.debug?.retrieval ?? [];
  const sources = snapshot.sources ?? [];

  let retrieval: EvalRetrievalSnapshot[] = [];
  if (parsed.length > 0) {
    retrieval = mergeParsedContextWithDebug(parsed, debugItems, sources);
  } else if (debugItems.length > 0) {
    retrieval = retrievalFromDebug(debugItems, sources);
  }

  return {
    ...snapshot,
    retrieval,
    citations: buildCitationMappings(snapshot.answer, retrieval),
  };
}

export function readBestStoredSnapshot(
  rows: Array<{ details?: Record<string, unknown> | null }>,
  isSnapshot: (value: unknown) => value is EvalCaseSnapshot,
): EvalCaseSnapshot | undefined {
  const snapshots = rows
    .map((row) => row.details?.snapshot)
    .filter((value): value is EvalCaseSnapshot => isSnapshot(value));

  if (snapshots.length === 0) return undefined;

  return snapshots.sort((left, right) => {
    const leftScore =
      (left.retrieval?.length ?? 0) +
      (left.context?.trim() ? 1 : 0) +
      (left.debug?.retrieval?.length ?? 0);
    const rightScore =
      (right.retrieval?.length ?? 0) +
      (right.context?.trim() ? 1 : 0) +
      (right.debug?.retrieval?.length ?? 0);
    return rightScore - leftScore;
  })[0];
}

export type EvalHydrationDocument = {
  id: string;
  name: string;
  url?: string | null;
};

export type EvalHydrationChunk = {
  id: string;
  content: string;
  parentContent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type EvalHydrationMaps = {
  documentsById?: Map<string, EvalHydrationDocument>;
  chunksById?: Map<string, EvalHydrationChunk>;
};

type MetricRow = { metric: string; details?: Record<string, unknown> | null };

function readCitationMetricDetails(rows: MetricRow[]) {
  const row = rows.find((item) => item.metric === "citationCorrectness");
  return row?.details;
}

function retrievalFromCitationDetails(
  details: Record<string, unknown>,
  hydration?: EvalHydrationMaps,
): EvalRetrievalSnapshot[] {
  const rawRetrieval = Array.isArray(details.retrieval) ? details.retrieval : [];
  if (rawRetrieval.length === 0) return [];

  return rawRetrieval.map((item, index) => {
    const record = item as Record<string, unknown>;
    const chunkId = typeof record.chunkId === "string" ? record.chunkId : `unknown-${index + 1}`;
    const documentId = typeof record.documentId === "string" ? record.documentId : `unknown-doc-${index + 1}`;
    const hydratedDoc = hydration?.documentsById?.get(documentId);
    const hydratedChunk = hydration?.chunksById?.get(chunkId);
    const metadata = hydratedChunk?.metadata ?? {};
    return {
      index: index + 1,
      chunkId,
      documentId,
      documentName: hydratedDoc?.name ?? (typeof record.documentName === "string" ? record.documentName : "Unknown source"),
      similarity: typeof record.similarity === "number" ? record.similarity : 0,
      content: hydratedChunk?.content ?? "",
      ...(hydratedChunk?.parentContent ? { parentContent: hydratedChunk.parentContent } : {}),
      ...(typeof metadata.page === "number" ? { page: metadata.page } : {}),
      ...(hydratedDoc?.url ? { url: hydratedDoc.url } : {}),
    };
  });
}

function citationsFromMetricDetails(
  details: Record<string, unknown>,
  retrieval: EvalRetrievalSnapshot[],
  hydration?: EvalHydrationMaps,
): EvalCitationMapping[] {
  const mappings = Array.isArray(details.citationMappings) ? details.citationMappings : [];
  if (mappings.length > 0) {
    return mappings.map((item) => {
      const record = item as Record<string, unknown>;
      const marker = Number(record.marker);
      const documentId = typeof record.documentId === "string" ? record.documentId : undefined;
      const chunkId = typeof record.chunkId === "string" ? record.chunkId : undefined;
      const hydratedDoc = documentId ? hydration?.documentsById?.get(documentId) : undefined;
      const chunk =
        retrieval.find((entry) => entry.index === marker) ??
        (chunkId ? retrieval.find((entry) => entry.chunkId === chunkId) : undefined);
      return {
        marker,
        documentId: documentId ?? chunk?.documentId,
        chunkId: chunkId ?? chunk?.chunkId,
        documentName:
          hydratedDoc?.name ??
          (typeof record.documentName === "string" ? record.documentName : undefined) ??
          chunk?.documentName,
        url: chunk?.url ?? hydratedDoc?.url ?? undefined,
      };
    });
  }

  return buildCitationMappings(
    typeof details.answer === "string" ? details.answer : "",
    retrieval,
  );
}

export function hydrateSnapshotFromMetrics(
  snapshot: EvalCaseSnapshot,
  rows: MetricRow[],
  hydration?: EvalHydrationMaps,
): EvalCaseSnapshot {
  const citationDetails = readCitationMetricDetails(rows);
  let next = enrichEvalCaseSnapshot(snapshot);

  if (next.retrieval.length === 0 && citationDetails) {
    const retrieval = retrievalFromCitationDetails(citationDetails, hydration);
    if (retrieval.length > 0) {
      next = {
        ...next,
        retrieval,
        citations: citationsFromMetricDetails({ ...citationDetails, answer: next.answer }, retrieval, hydration),
      };
    }
  }

  if (hydration?.documentsById) {
    next = {
      ...next,
      retrieval: next.retrieval.map((chunk) => {
        const doc = hydration.documentsById?.get(chunk.documentId);
        return {
          ...chunk,
          documentName: doc?.name ?? chunk.documentName,
          ...(chunk.url || doc?.url ? { url: chunk.url ?? doc?.url ?? undefined } : {}),
        };
      }),
      citations: next.citations.map((citation) => {
        const doc = citation.documentId ? hydration.documentsById?.get(citation.documentId) : undefined;
        return {
          ...citation,
          documentName: doc?.name ?? citation.documentName,
          ...(citation.url || doc?.url ? { url: citation.url ?? doc?.url ?? undefined } : {}),
        };
      }),
    };
  }

  return next;
}

export function detectRetrievalInconsistency(snapshot: EvalCaseSnapshot) {
  const hasCitations = extractCitationIndexes(snapshot.answer).length > 0;
  return snapshot.outcome === "answered_with_context" && hasCitations && snapshot.retrieval.length === 0;
}

export function hasEvidenceOfRetrieval(snapshot: EvalCaseSnapshot) {
  return Boolean(
    snapshot.retrieval.length > 0 ||
      parseContextBlocks(snapshot.context).length > 0 ||
      (snapshot.debug?.retrieval?.length ?? 0) > 0 ||
      snapshot.sources.length > 0 ||
      extractCitationIndexes(snapshot.answer).length > 0,
  );
}
