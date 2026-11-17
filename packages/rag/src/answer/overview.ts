import type { AssistantOverview, KeyFact, KeyFactSource, OverviewClaim } from "@chatai/database";

type SourceDocument = { id: string; status: string; excluded: boolean; contentHash: string | null };

export type ActiveOverviewClaim = OverviewClaim & {
  /** Citation id for this turn when overview is used as evidence (e.g. "o1"). */
  citationId: string;
};

/**
 * Approved overview claims whose fact ids still exist among active facts and whose
 * sources still match ready documents. Suggestions and invalidated overviews never serve.
 */
export function activeOverviewClaims(
  overview: AssistantOverview | null | undefined,
  activeFactIds: Set<string>,
  docs: Map<string, SourceDocument>,
): ActiveOverviewClaim[] {
  if (!overview || overview.status !== "approved" || overview.claims.length === 0) return [];

  const active: ActiveOverviewClaim[] = [];
  let index = 0;
  for (const claim of overview.claims) {
    if (claim.factIds.length === 0) continue;
    if (!claim.factIds.every((factId) => activeFactIds.has(factId))) continue;
    if (claim.sources.length > 0 && !sourcesCurrent(claim.sources, docs)) continue;
    index += 1;
    active.push({ ...claim, citationId: `o${index}` });
  }
  return active;
}

function sourcesCurrent(sources: KeyFactSource[], docs: Map<string, SourceDocument>): boolean {
  return sources.every((source) => {
    const doc = docs.get(source.documentId);
    return (
      doc !== undefined &&
      doc.status === "ready" &&
      !doc.excluded &&
      (source.contentHash === null || source.contentHash === doc.contentHash)
    );
  });
}

/**
 * When documents are deleted/updated, invalidate overview claims that depended on them.
 * Returns a new overview object (or the same reference when unchanged).
 */
export function invalidateOverviewForDocuments(
  overview: AssistantOverview | null | undefined,
  documentIds: Set<string>,
): AssistantOverview | null {
  if (!overview || documentIds.size === 0) return overview ?? null;
  if (overview.status === "suggestion") {
    // Drop affected suggestion claims; keep remaining as suggestion.
    const claims = overview.claims.filter(
      (claim) => !claim.sources.some((source) => documentIds.has(source.documentId)),
    );
    if (claims.length === overview.claims.length) return overview;
    return { ...overview, claims, version: overview.version + 1 };
  }
  const affected = overview.claims.some((claim) =>
    claim.sources.some((source) => documentIds.has(source.documentId)),
  );
  if (!affected) return overview;
  return {
    ...overview,
    status: "invalidated",
    version: overview.version + 1,
    approvedAt: null,
    approvedBy: null,
  };
}

/** Invalidate overview claims that reference removed or inactive fact ids. */
export function invalidateOverviewForFacts(
  overview: AssistantOverview | null | undefined,
  remainingFactIds: Set<string>,
): AssistantOverview | null {
  if (!overview) return null;
  const affected = overview.claims.some((claim) =>
    claim.factIds.some((factId) => !remainingFactIds.has(factId)),
  );
  if (!affected) return overview;
  if (overview.status === "suggestion") {
    return {
      ...overview,
      claims: overview.claims.filter((claim) => claim.factIds.every((id) => remainingFactIds.has(id))),
      version: overview.version + 1,
    };
  }
  return {
    ...overview,
    status: "invalidated",
    version: overview.version + 1,
    approvedAt: null,
    approvedBy: null,
  };
}

export function isOverviewOrIdentityRequest(message: string): boolean {
  const text = message.toLowerCase().replace(/[’`]/g, "'").trim();
  if (!text || text.length > 200) return false;
  if (
    /\b(tell me|tell us) about (him|her|them|you|this)\b/.test(text) ||
    /\bwho (is|are) (he|she|they|you|this)\b/.test(text) ||
    /\b(what do (you|they|she|he) do)\b/.test(text)
  ) {
    return true;
  }
  return false;
}

/** Structured facts alone can support an overview before any narrative is approved. */
export function factsSupportOverview(facts: KeyFact[]): boolean {
  return facts.length >= 2;
}
