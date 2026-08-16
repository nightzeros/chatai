import type { MessageSource } from "@chatai/database";

import type { RetrievedChunk } from "./retrieve";

export function extractCitationIndexes(answer: string): number[] {
  const indexes = new Set<number>();
  const pattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(answer)) !== null) {
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) {
      indexes.add(value);
    }
  }
  return [...indexes];
}

export function sourcesFromAnswer(answer: string, retrieved: RetrievedChunk[]): MessageSource[] {
  const cited = extractCitationIndexes(answer)
    .map((index) => retrieved[index - 1])
    .filter((chunk): chunk is RetrievedChunk => Boolean(chunk));

  const selected = cited.length > 0 ? cited : retrieved;

  const seen = new Set<string>();
  const sources: MessageSource[] = [];

  for (const chunk of selected) {
    const key = `${chunk.documentId}:${chunk.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push({
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      chunkId: chunk.chunkId,
      ...(chunk.page !== undefined ? { page: chunk.page } : {}),
      excerpt: chunk.content.slice(0, 240),
    });
  }

  return sources;
}
