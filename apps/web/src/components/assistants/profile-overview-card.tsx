"use client";

import { useActionState, useEffect, useMemo, useState } from "react";

import {
  approveOverview,
  clearOverview,
  requestOverviewSuggestion,
  saveOverviewDraft,
  type ProfileActionState,
} from "@/app/dashboard/assistants/[id]/profile/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type OverviewClaimView = {
  id: string;
  text: string;
  factIds: string[];
  factLabels: string[];
};

export type OverviewView = {
  status: "suggestion" | "approved" | "invalidated";
  version: number;
  claims: OverviewClaimView[];
  suggestedAt: string | null;
  approvedAt: string | null;
};

type FactOption = { id: string; text: string };

type DraftClaim = {
  id: string;
  text: string;
  factIds: string[];
};

type Props = {
  assistantId: string;
  version: number | null;
  overview: OverviewView | null;
  facts: FactOption[];
};

function Feedback({ state }: { state: ProfileActionState }) {
  if (!state) return null;
  if ("error" in state) return <p className="text-sm text-destructive">{state.error}</p>;
  return state.message ? <p className="text-sm text-muted-foreground">{state.message}</p> : null;
}

function Hidden({
  assistantId,
  version,
  claimsJson,
}: {
  assistantId: string;
  version: number | null;
  claimsJson?: string;
}) {
  return (
    <>
      <input type="hidden" name="id" value={assistantId} />
      <input type="hidden" name="version" value={version ?? ""} />
      {claimsJson !== undefined ? <input type="hidden" name="claimsJson" value={claimsJson} /> : null}
    </>
  );
}

const STATUS_LABEL: Record<OverviewView["status"], string> = {
  suggestion: "Suggestion (not live)",
  approved: "Approved — live for Text and Voice",
  invalidated: "Invalidated — re-approve after review",
};

function toDraft(overview: OverviewView | null): DraftClaim[] {
  if (!overview || overview.claims.length === 0) return [];
  return overview.claims.map((claim) => ({
    id: claim.id,
    text: claim.text,
    factIds: [...claim.factIds],
  }));
}

export function ProfileOverviewCard({ assistantId, version, overview, facts }: Props) {
  const [claims, setClaims] = useState<DraftClaim[]>(() => toDraft(overview));
  const overviewKey = overview
    ? `${overview.status}:${overview.version}:${overview.claims.map((claim) => claim.id).join(",")}`
    : "none";
  useEffect(() => {
    setClaims(toDraft(overview));
    // overviewKey captures status/version/claim ids from the server payload.
  }, [overviewKey]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally keyed by overview identity
  const claimsJson = useMemo(() => JSON.stringify(claims), [claims]);
  const [suggestState, suggestAction, suggesting] = useActionState<ProfileActionState, FormData>(
    requestOverviewSuggestion,
    null,
  );
  const [saveState, saveAction, saving] = useActionState<ProfileActionState, FormData>(saveOverviewDraft, null);
  const [approveState, approveAction, approving] = useActionState<ProfileActionState, FormData>(
    approveOverview,
    null,
  );
  const [clearState, clearAction, clearing] = useActionState<ProfileActionState, FormData>(clearOverview, null);

  const canDraft = facts.length > 0;
  const status = overview?.status ?? null;

  const updateClaim = (index: number, patch: Partial<DraftClaim>) => {
    setClaims((prev) => prev.map((claim, i) => (i === index ? { ...claim, ...patch } : claim)));
  };

  const toggleFact = (index: number, factId: string) => {
    setClaims((prev) =>
      prev.map((claim, i) => {
        if (i !== index) return claim;
        const has = claim.factIds.includes(factId);
        return {
          ...claim,
          factIds: has ? claim.factIds.filter((id) => id !== factId) : [...claim.factIds, factId],
        };
      }),
    );
  };

  const addClaim = () => {
    if (claims.length >= 4) return;
    setClaims((prev) => [
      ...prev,
      { id: `new-${prev.length + 1}`, text: "", factIds: facts[0] ? [facts[0].id] : [] },
    ]);
  };

  const removeClaim = (index: number) => {
    setClaims((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
        <CardDescription>
          Short claim-linked narrative for “tell me about them” style questions. Each claim must reference
          published key facts. Suggestions are never served until you approve.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status:</span>
          {status ? (
            <Badge
              variant={
                status === "approved" ? "success" : status === "invalidated" ? "warning" : "secondary"
              }
            >
              {STATUS_LABEL[status]}
            </Badge>
          ) : (
            <Badge variant="secondary">None yet</Badge>
          )}
          {!canDraft ? (
            <span className="text-muted-foreground">Publish key facts first to draft an overview.</span>
          ) : null}
        </div>

        {claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No overview claims yet. Draft from your key facts, then edit and approve.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {claims.map((claim, index) => (
              <div key={claim.id} className="rounded-md border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Label htmlFor={`overview-claim-${index}`}>Claim {index + 1}</Label>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeClaim(index)}>
                    Remove
                  </Button>
                </div>
                <Textarea
                  id={`overview-claim-${index}`}
                  rows={3}
                  value={claim.text}
                  onChange={(event) => updateClaim(index, { text: event.target.value })}
                  placeholder="Ada builds booking products for clinics."
                />
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Supported by key facts</p>
                  <div className="flex flex-col gap-2">
                    {facts.map((fact) => (
                      <label key={fact.id} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={claim.factIds.includes(fact.id)}
                          onChange={() => toggleFact(index, fact.id)}
                        />
                        <span className="text-muted-foreground">{fact.text}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={addClaim} disabled={claims.length >= 4 || !canDraft}>
            Add claim
          </Button>
          <form action={saveAction}>
            <Hidden assistantId={assistantId} version={version} claimsJson={claimsJson} />
            <Button type="submit" size="sm" variant="outline" disabled={saving || claims.length === 0}>
              {saving ? "Saving…" : "Save draft"}
            </Button>
          </form>
          <form action={approveAction}>
            <Hidden assistantId={assistantId} version={version} claimsJson={claimsJson} />
            <Button type="submit" size="sm" disabled={approving || claims.length === 0}>
              {approving ? "Approving…" : "Approve overview"}
            </Button>
          </form>
          <Feedback state={saveState} />
          <Feedback state={approveState} />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <form action={suggestAction}>
            <Hidden assistantId={assistantId} version={version} />
            <Button type="submit" variant="outline" size="sm" disabled={suggesting || !canDraft}>
              {suggesting ? "Drafting…" : "Suggest overview"}
            </Button>
          </form>
          {overview ? (
            <form action={clearAction}>
              <Hidden assistantId={assistantId} version={version} />
              <Button type="submit" variant="ghost" size="sm" disabled={clearing}>
                Clear overview
              </Button>
            </form>
          ) : null}
          <Feedback state={suggestState} />
          <Feedback state={clearState} />
        </div>
      </CardContent>
    </Card>
  );
}
