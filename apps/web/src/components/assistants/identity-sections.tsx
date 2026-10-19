import { assistantProfiles, documents, eq } from "@chatai/database";
import { activeFacts, buildScopeProfile, instructionsHash } from "@chatai/rag/answer";

import { ProfileFactsCard } from "@/components/assistants/profile-facts-card";
import { ProfileOverviewCard } from "@/components/assistants/profile-overview-card";
import { ProfilePurposeCard } from "@/components/assistants/profile-purpose-card";
import type { Assistant } from "@/lib/assistants";
import { db } from "@/lib/db";

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export async function IdentityProfileSections({ assistant }: { assistant: Assistant }) {
  let row: typeof assistantProfiles.$inferSelect | null = null;
  let tablesMissing = false;
  try {
    [row = null] = await db()
      .select()
      .from(assistantProfiles)
      .where(eq(assistantProfiles.assistantId, assistant.id))
      .limit(1);
  } catch {
    tablesMissing = true;
  }

  const docs = await db()
    .select({
      id: documents.id,
      name: documents.name,
      status: documents.status,
      excluded: documents.excluded,
      contentHash: documents.contentHash,
    })
    .from(documents)
    .where(eq(documents.assistantId, assistant.id));
  const docMap = new Map(docs.map((doc) => [doc.id, doc]));
  const nameOf = (documentId: string) => {
    const doc = docMap.get(documentId);
    return doc ? decodeName(doc.name) : null;
  };
  const names = (ids: string[]) => [...new Set(ids.map(nameOf).filter((n): n is string => Boolean(n)))];

  const facts = row?.facts ?? [];
  const activeIds = new Set(activeFacts(facts, docMap).map((fact) => fact.id));
  const purpose = row?.purpose ?? null;
  const enforced = buildScopeProfile({
    assistantName: assistant.name,
    description: assistant.description,
    instructions: assistant.instructions,
    purpose,
  });

  if (tablesMissing) {
    return (
      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        The Assistant Profile is not available yet: apply database migration 0020 on this instance. Scope
        enforcement keeps working from your Instructions until then.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground">Purpose, facts & overview</h2>
        <p className="text-sm text-muted-foreground">
          Define what this assistant helps with and the key facts it can always use. Text and Voice share
          this profile.
        </p>
      </div>
      <section id="purpose" className="scroll-mt-6">
        <ProfilePurposeCard
          assistantId={assistant.id}
          version={row?.version ?? null}
          enforcedSource={enforced.purposeSource}
          purpose={
            purpose
              ? {
                  summary: purpose.summary,
                  represents: purpose.represents ?? "",
                  redirect: purpose.redirect ?? "",
                  mode: purpose.mode,
                  confirmedAt: purpose.confirmedAt,
                  instructionsChanged:
                    purpose.instructionsHash !== null &&
                    purpose.instructionsHash !== instructionsHash(assistant.instructions),
                }
              : null
          }
          suggestion={
            row?.purposeSuggestion
              ? {
                  summary: row.purposeSuggestion.summary,
                  represents: row.purposeSuggestion.represents ?? "",
                  redirect: row.purposeSuggestion.redirect ?? "",
                  basis: row.purposeSuggestion.basis,
                }
              : null
          }
        />
      </section>
      <section id="facts" className="scroll-mt-6">
        <ProfileFactsCard
          assistantId={assistant.id}
          version={row?.version ?? null}
          published={Boolean(row?.factsPublishedAt)}
          refreshStatus={row?.refreshStatus ?? "idle"}
          lastError={row?.lastError ?? null}
          facts={facts.map((fact) => ({
            id: fact.id,
            text: fact.text,
            topic: fact.topic,
            origin: fact.origin,
            stale: !activeIds.has(fact.id),
            sourceNames: names(fact.sources.map((source) => source.documentId)),
          }))}
          suggestions={(row?.suggestions ?? []).map((suggestion) => ({
            id: suggestion.id,
            text: suggestion.text,
            topic: suggestion.topic,
            action: suggestion.action,
            replacesText: suggestion.replacesFactId
              ? (facts.find((fact) => fact.id === suggestion.replacesFactId)?.text ?? null)
              : null,
            sourceNames: names(suggestion.sources.map((source) => source.documentId)),
            quote: suggestion.sources[0]?.quote ?? null,
          }))}
          conflicts={(row?.conflicts ?? []).map((conflict) => ({
            topic: conflict.topic,
            sourceNames: names(conflict.documentIds),
          }))}
        />
      </section>
      <section id="overview" className="scroll-mt-6">
        <ProfileOverviewCard
          assistantId={assistant.id}
          version={row?.version ?? null}
          overview={
            row?.overview
              ? {
                  status: row.overview.status,
                  version: row.overview.version,
                  suggestedAt: row.overview.suggestedAt ?? null,
                  approvedAt: row.overview.approvedAt ?? null,
                  claims: row.overview.claims.map((claim) => ({
                    id: claim.id,
                    text: claim.text,
                    factIds: claim.factIds,
                    factLabels: claim.factIds.map(
                      (factId) => facts.find((fact) => fact.id === factId)?.text ?? factId,
                    ),
                  })),
                }
              : null
          }
          facts={facts
            .filter((fact) => activeIds.has(fact.id))
            .map((fact) => ({ id: fact.id, text: fact.text }))}
        />
      </section>
    </div>
  );
}
