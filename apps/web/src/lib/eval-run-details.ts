import {
  and,
  chunks,
  documents,
  eq,
  evalCases,
  evalRuns,
  evalScores,
  evalSets,
  inArray,
  messages,
} from "@chatai/database";
import {
  buildEvalRunDetails,
  type EvalHydrationDocument,
  type EvalHydrationChunk,
  type EvalHydrationMaps,
  type EvalRunDetails,
} from "@chatai/evals";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";

function collectHydrationIds(scores: Array<{ details?: Record<string, unknown> | null }>) {
  const documentIds = new Set<string>();
  const chunkIds = new Set<string>();

  for (const row of scores) {
    const details = row.details;
    if (!details) continue;

    const snapshot = details.snapshot;
    if (snapshot && typeof snapshot === "object") {
      const record = snapshot as Record<string, unknown>;
      const retrieval = Array.isArray(record.retrieval) ? record.retrieval : [];
      for (const item of retrieval) {
        if (item && typeof item === "object") {
          const chunk = item as Record<string, unknown>;
          if (typeof chunk.documentId === "string") documentIds.add(chunk.documentId);
          if (typeof chunk.chunkId === "string") chunkIds.add(chunk.chunkId);
        }
      }
      const sources = Array.isArray(record.sources) ? record.sources : [];
      for (const source of sources) {
        if (source && typeof source === "object") {
          const item = source as Record<string, unknown>;
          if (typeof item.documentId === "string") documentIds.add(item.documentId);
          if (typeof item.chunkId === "string") chunkIds.add(item.chunkId);
        }
      }
    }

    const mappings = Array.isArray(details.citationMappings) ? details.citationMappings : [];
    for (const mapping of mappings) {
      if (mapping && typeof mapping === "object") {
        const item = mapping as Record<string, unknown>;
        if (typeof item.documentId === "string") documentIds.add(item.documentId);
        if (typeof item.chunkId === "string") chunkIds.add(item.chunkId);
      }
    }

    const citedDocuments = Array.isArray(details.citedDocuments) ? details.citedDocuments : [];
    for (const documentId of citedDocuments) {
      if (typeof documentId === "string") documentIds.add(documentId);
    }

    const retrieval = Array.isArray(details.retrieval) ? details.retrieval : [];
    for (const item of retrieval) {
      if (item && typeof item === "object") {
        const chunk = item as Record<string, unknown>;
        if (typeof chunk.documentId === "string") documentIds.add(chunk.documentId);
        if (typeof chunk.chunkId === "string") chunkIds.add(chunk.chunkId);
      }
    }
  }

  return { documentIds: [...documentIds], chunkIds: [...chunkIds] };
}

async function loadHydrationMaps(
  documentIds: string[],
  chunkIds: string[],
): Promise<EvalHydrationMaps> {
  const documentsById = new Map<string, EvalHydrationDocument>();
  const chunksById = new Map<string, EvalHydrationChunk>();

  if (documentIds.length > 0) {
    const rows = await db()
      .select({ id: documents.id, name: documents.name, url: documents.url })
      .from(documents)
      .where(inArray(documents.id, documentIds));
    for (const row of rows) {
      documentsById.set(row.id, row);
    }
  }

  if (chunkIds.length > 0) {
    const rows = await db()
      .select({
        id: chunks.id,
        content: chunks.content,
        parentContent: chunks.parentContent,
        metadata: chunks.metadata,
      })
      .from(chunks)
      .where(inArray(chunks.id, chunkIds));
    for (const row of rows) {
      chunksById.set(row.id, row);
    }
  }

  return { documentsById, chunksById };
}

export async function getEvalRunDetails(
  userId: string,
  assistantId: string,
  runId: string,
): Promise<EvalRunDetails | null> {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const [run] = await db()
    .select()
    .from(evalRuns)
    .where(and(eq(evalRuns.id, runId), eq(evalRuns.assistantId, assistantId)))
    .limit(1);

  if (!run) return null;

  const scores = await db().select().from(evalScores).where(eq(evalScores.runId, runId));

  let evalSetName: string | null = null;
  let cases: Array<{ id: string; question: string; expectedAnswer: string | null }> = [];
  if (run.evalSetId) {
    const [set] = await db().select().from(evalSets).where(eq(evalSets.id, run.evalSetId)).limit(1);
    evalSetName = set?.name ?? null;
    cases = await db().select().from(evalCases).where(eq(evalCases.evalSetId, run.evalSetId));
  }

  const messageIds = [...new Set(scores.map((row) => row.messageId).filter(Boolean))] as string[];
  const messageRows =
    messageIds.length > 0
      ? await db()
          .select({
            id: messages.id,
            content: messages.content,
            sources: messages.sources,
            outcome: messages.outcome,
            debug: messages.debug,
          })
          .from(messages)
          .where(inArray(messages.id, messageIds))
      : [];

  const { documentIds, chunkIds } = collectHydrationIds(scores);
  const hydration = await loadHydrationMaps(documentIds, chunkIds);

  return buildEvalRunDetails({
    run: {
      id: run.id,
      assistantId: run.assistantId,
      evalSetId: run.evalSetId,
      evalSetName,
      kind: run.kind,
      status: run.status,
      summary: run.summary,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    scores,
    cases,
    messages: messageRows,
    hydration,
  });
}
