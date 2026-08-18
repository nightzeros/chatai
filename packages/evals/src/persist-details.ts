import type { EvalCaseSnapshot } from "./eval-snapshot";
import type { EvalScoreResult } from "./types";
import { toEvalDebugRetrieval } from "./eval-retrieval";
import type { RetrievedChunk } from "@chatai/rag/answer";

export function assertEvalSnapshot(snapshot: EvalCaseSnapshot, outcome: string, contextChunkCount: number) {
  if (outcome === "answered_with_context" && contextChunkCount === 0) {
    throw new Error("Eval invariant: answered_with_context but no retrieved chunks were captured.");
  }
  if (contextChunkCount > 0 && snapshot.retrieval.length === 0) {
    throw new Error("Eval invariant: snapshot missing retrieval despite retrieved chunks.");
  }
  if (contextChunkCount > 0 && !snapshot.context.trim()) {
    throw new Error("Eval invariant: snapshot missing context despite retrieved chunks.");
  }
}

export function attachEvalScoreDetails(opts: {
  score: EvalScoreResult;
  snapshot: EvalCaseSnapshot;
  contextChunks: RetrievedChunk[];
}) {
  const details: Record<string, unknown> = {
    ...(opts.score.details ?? {}),
    snapshot: opts.snapshot,
  };

  if (opts.score.metric === "citationCorrectness" && opts.score.details) {
    const raw = opts.score.details;
    const citations = Array.isArray(raw.citations) ? raw.citations : [];
    const citedDocuments = Array.isArray(raw.citedDocuments) ? raw.citedDocuments : [];
    if (citations.length > 0 && !("invalid" in raw)) {
      details.citationMappings = citations.map((marker, index) => {
        const chunk = opts.contextChunks[Number(marker) - 1];
        return {
          marker: Number(marker),
          documentId: citedDocuments[index] ?? chunk?.documentId,
          chunkId: chunk?.chunkId,
          documentName: chunk?.documentName,
        };
      });
      details.retrieval = toEvalDebugRetrieval(opts.contextChunks);
    }
  }

  return details;
}

export function readPersistedSnapshot(details?: Record<string, unknown> | null): EvalCaseSnapshot | undefined {
  const snapshot = details?.snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  const record = snapshot as Record<string, unknown>;
  if (typeof record.question !== "string" || typeof record.answer !== "string") return undefined;
  return snapshot as EvalCaseSnapshot;
}
