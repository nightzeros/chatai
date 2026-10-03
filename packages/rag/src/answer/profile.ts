import {
  and,
  assistantProfiles,
  documents,
  eq,
  inArray,
  type AssistantPurpose,
  type Database,
  type KeyFact,
} from "@chatai/database";

import type { RetrievedChunk } from "./retrieve";

/**
 * Serve-time Assistant Profile: the owner's Purpose and the published Key facts
 * that are still backed by their source documents. A fact whose source document
 * was deleted, excluded, is not ready, or changed since the fact was verified is
 * hidden until the owner reviews a refreshed suggestion. Any failure (including a
 * missing table before migration 0020) returns an empty profile: scope then falls
 * back to the owner's Instructions, never to a wider domain.
 */

export type ActiveKeyFact = KeyFact & { documentId: string; documentName: string };

export type AssistantContext = {
  purpose: AssistantPurpose | null;
  facts: ActiveKeyFact[];
  /** Profile version used for this turn (null when no profile row exists). */
  version: number | null;
};

export const EMPTY_ASSISTANT_CONTEXT: AssistantContext = { purpose: null, facts: [], version: null };

const OWNER_FACTS_DOCUMENT_ID = "key-facts";
const OWNER_FACTS_DOCUMENT_NAME = "Key facts";
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; value: AssistantContext }>();

/** Drop the cached profile after an owner change in this process (other processes expire within 30 s). */
export function invalidateAssistantContext(assistantId: string): void {
  cache.delete(assistantId);
}

type SourceDocument = { id: string; name: string; status: string; excluded: boolean; contentHash: string | null };

export function activeFacts(facts: KeyFact[], docs: Map<string, SourceDocument>): ActiveKeyFact[] {
  const active: ActiveKeyFact[] = [];
  for (const fact of facts) {
    if (fact.sources.length === 0) {
      if (fact.origin !== "owner") continue;
      active.push({ ...fact, documentId: OWNER_FACTS_DOCUMENT_ID, documentName: OWNER_FACTS_DOCUMENT_NAME });
      continue;
    }
    const valid = fact.sources.every((source) => {
      const doc = docs.get(source.documentId);
      return (
        doc !== undefined &&
        doc.status === "ready" &&
        !doc.excluded &&
        (source.contentHash === null || source.contentHash === doc.contentHash)
      );
    });
    if (!valid) continue;
    const doc = docs.get(fact.sources[0]!.documentId)!;
    active.push({ ...fact, documentId: doc.id, documentName: safeDecode(doc.name) });
  }
  return active;
}

export async function loadAssistantContext(db: Database, assistantId: string): Promise<AssistantContext> {
  const cached = cache.get(assistantId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  let value: AssistantContext;
  try {
    const [row] = await db
      .select({
        purpose: assistantProfiles.purpose,
        facts: assistantProfiles.facts,
        version: assistantProfiles.version,
      })
      .from(assistantProfiles)
      .where(eq(assistantProfiles.assistantId, assistantId))
      .limit(1);
    if (!row) {
      value = EMPTY_ASSISTANT_CONTEXT;
    } else {
      const facts = Array.isArray(row.facts) ? row.facts : [];
      const documentIds = [...new Set(facts.flatMap((fact) => fact.sources.map((source) => source.documentId)))];
      const docs = new Map<string, SourceDocument>();
      if (documentIds.length > 0) {
        const rows = await db
          .select({
            id: documents.id,
            name: documents.name,
            status: documents.status,
            excluded: documents.excluded,
            contentHash: documents.contentHash,
          })
          .from(documents)
          .where(and(eq(documents.assistantId, assistantId), inArray(documents.id, documentIds)));
        for (const doc of rows) docs.set(doc.id, doc);
      }
      value = { purpose: row.purpose ?? null, facts: activeFacts(facts, docs), version: row.version };
    }
  } catch {
    return EMPTY_ASSISTANT_CONTEXT;
  }
  cache.set(assistantId, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

/** Published facts as background sources appended after retrieval results (never affects the decision). */
export function keyFactChunks(facts: ActiveKeyFact[]): RetrievedChunk[] {
  return facts.map((fact) => ({
    chunkId: `fact:${fact.id}`,
    documentId: fact.documentId,
    documentName: fact.documentName,
    content: fact.text,
    similarity: 0,
    keyFact: true,
  }));
}

function safeDecode(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
