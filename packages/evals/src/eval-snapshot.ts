import type { MessageDebug, MessageSource } from "@chatai/database";
import type { RetrievedChunk } from "@chatai/rag/answer";
import { buildContextBlocks } from "@chatai/rag/answer";

import { contextChunksForEval } from "./eval-retrieval";

export type EvalRetrievalSnapshot = {
  index: number;
  chunkId: string;
  documentId: string;
  documentName: string;
  similarity: number;
  content: string;
  parentContent?: string;
  page?: number;
  heading?: string;
  url?: string;
  hybrid?: {
    vectorRank?: number;
    keywordRank?: number;
    rrfScore?: number;
  };
};

export type EvalCitationMapping = {
  marker: number;
  chunkId?: string;
  documentId?: string;
  documentName?: string;
  url?: string;
};

export type EvalCaseSnapshot = {
  question: string;
  expectedAnswer?: string | null;
  answer: string;
  outcome?: string;
  context: string;
  sources: MessageSource[];
  retrieval: EvalRetrievalSnapshot[];
  citations: EvalCitationMapping[];
  debug?: MessageDebug;
  model?: string;
  provider?: string;
};

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

function toRetrievalSnapshot(chunks: RetrievedChunk[]): EvalRetrievalSnapshot[] {
  return chunks.map((chunk, index) => ({
    index: index + 1,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    similarity: chunk.similarity,
    content: chunk.content,
    ...(chunk.parentContent ? { parentContent: chunk.parentContent } : {}),
    ...(chunk.page !== undefined ? { page: chunk.page } : {}),
    ...(chunk.heading !== undefined ? { heading: chunk.heading } : {}),
    ...(chunk.hybrid ? { hybrid: chunk.hybrid } : {}),
    ...(chunk.url ? { url: chunk.url } : {}),
  }));
}

export function buildEvalCaseSnapshot(opts: {
  question: string;
  expectedAnswer?: string | null;
  answer: string;
  outcome?: string;
  retrieved: RetrievedChunk[];
  sources: MessageSource[];
  debug?: MessageDebug;
  model?: string;
  provider?: string;
}): EvalCaseSnapshot {
  const contextChunks = contextChunksForEval(opts.retrieved);
  const retrieval = toRetrievalSnapshot(contextChunks);

  return {
    question: opts.question,
    ...(opts.expectedAnswer !== undefined ? { expectedAnswer: opts.expectedAnswer } : {}),
    answer: opts.answer,
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
    context: buildContextBlocks(contextChunks),
    sources: opts.sources,
    retrieval,
    citations: buildCitationMappings(opts.answer, retrieval),
    ...(opts.debug ? { debug: opts.debug } : {}),
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.provider ? { provider: opts.provider } : {}),
  };
}
