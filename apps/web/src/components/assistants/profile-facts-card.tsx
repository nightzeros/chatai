"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  acceptAllSuggestions,
  acceptSuggestion,
  generateFacts,
  rejectSuggestion,
  removeFact,
  saveFact,
  type ProfileActionState,
} from "@/app/dashboard/assistants/[id]/profile/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type FactView = {
  id: string;
  text: string;
  topic: string;
  origin: "generated" | "owner";
  /** Hidden from answers until reviewed: a source document changed, was removed or excluded. */
  stale: boolean;
  sourceNames: string[];
};

export type SuggestionView = {
  id: string;
  text: string;
  topic: string;
  action: "add" | "replace";
  replacesText: string | null;
  sourceNames: string[];
  quote: string | null;
};

type Props = {
  assistantId: string;
  version: number | null;
  facts: FactView[];
  suggestions: SuggestionView[];
  conflicts: Array<{ topic: string; sourceNames: string[] }>;
  refreshStatus: "idle" | "pending" | "running" | "failed";
  lastError: string | null;
  published: boolean;
};

const REFRESH_POLL_MS = 2500;

function Feedback({ state }: { state: ProfileActionState }) {
  if (!state) return null;
  if ("error" in state) return <p className="text-sm text-destructive">{state.error}</p>;
  return state.message ? <p className="text-sm text-muted-foreground">{state.message}</p> : null;
}

function Hidden({ assistantId, version }: { assistantId: string; version: number | null }) {
  return (
    <>
      <input type="hidden" name="id" value={assistantId} />
      <input type="hidden" name="version" value={version ?? ""} />
    </>
  );
}

export function ProfileFactsCard(props: Props) {
  const { assistantId, version, facts, suggestions, conflicts, refreshStatus, lastError, published } = props;
  const [generateState, generateAction, generating] = useActionState<ProfileActionState, FormData>(generateFacts, null);
  const [acceptAllState, acceptAllAction, acceptingAll] = useActionState<ProfileActionState, FormData>(
    acceptAllSuggestions,
    null,
  );
  const [rowState, setRowState] = useState<ProfileActionState>(null);
  const [acceptState, acceptAction] = useActionState<ProfileActionState, FormData>(async (prev, data) => {
    const result = await acceptSuggestion(prev, data);
    setRowState(result);
    return result;
  }, null);
  const [, rejectAction] = useActionState<ProfileActionState, FormData>(async (prev, data) => {
    const result = await rejectSuggestion(prev, data);
    setRowState(result);
    return result;
  }, null);
  const [, removeAction] = useActionState<ProfileActionState, FormData>(async (prev, data) => {
    const result = await removeFact(prev, data);
    setRowState(result);
    return result;
  }, null);
  const [saveState, saveAction, savingFact] = useActionState<ProfileActionState, FormData>(saveFact, null);
  const [editing, setEditing] = useState<string | null>(null);
  const busy = refreshStatus === "pending" || refreshStatus === "running";
  const router = useRouter();
  useEffect(() => {
    if (!busy) return;
    // Generation runs in the background worker; re-read the profile until it settles.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, router]);
  const hidden = <Hidden assistantId={assistantId} version={version} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Key facts</CardTitle>
        <CardDescription>
          Short facts answers can always draw on, such as contact details, hours or offerings. Generated facts
          are suggestions until you accept them, and each one is checked against a word-for-word quote from your
          Knowledge. Key facts never change what the assistant helps with; that is the Purpose.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <form action={generateAction}>
            {hidden}
            <Button type="submit" variant="outline" size="sm" disabled={generating || busy}>
              {busy ? "Generating…" : published ? "Refresh suggestions" : "Generate suggestions from Knowledge"}
            </Button>
          </form>
          {refreshStatus === "failed" ? (
            <Badge variant="danger">Last generation failed{lastError ? ` (${lastError.replace(/_/g, " ")})` : ""}</Badge>
          ) : null}
          {busy || (generateState && "error" in generateState) ? <Feedback state={generateState} /> : null}
        </div>
        {published ? (
          <p className="text-xs text-muted-foreground">
            When your Knowledge changes, new suggestions are prepared automatically (at most 24 times a day). Nothing
            is published without your review.
          </p>
        ) : null}

        {suggestions.length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Suggestions to review ({suggestions.length})</p>
              <form action={acceptAllAction}>
                {hidden}
                <Button type="submit" size="sm" disabled={acceptingAll}>
                  Accept all verified
                </Button>
              </form>
            </div>
            <Feedback state={acceptAllState} />
            <ul className="flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{suggestion.topic}</Badge>
                    {suggestion.action === "replace" ? <Badge variant="info">Replaces a published fact</Badge> : null}
                  </div>
                  <p className="mt-2">{suggestion.text}</p>
                  {suggestion.replacesText ? (
                    <p className="mt-1 text-muted-foreground line-through">{suggestion.replacesText}</p>
                  ) : null}
                  {suggestion.quote ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      “{suggestion.quote}” — {suggestion.sourceNames.join(", ") || "source"}
                    </p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <form action={acceptAction}>
                      {hidden}
                      <input type="hidden" name="suggestionId" value={suggestion.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Accept
                      </Button>
                    </form>
                    <form action={rejectAction}>
                      {hidden}
                      <input type="hidden" name="suggestionId" value={suggestion.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Reject
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {conflicts.length > 0 ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Conflicting information</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {conflicts.map((conflict) => (
                <li key={conflict.topic}>
                  {conflict.topic}: your documents disagree ({conflict.sourceNames.join(", ") || "several documents"}).
                  Add the correct fact yourself or fix the documents.
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">Published ({facts.length})</p>
          <Feedback state={rowState ?? acceptState} />
          {facts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No key facts yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {facts.map((fact) =>
                editing === fact.id ? (
                  <li key={fact.id} className="rounded-md border border-border p-3">
                    <form action={saveAction} className="flex flex-col gap-2" onSubmit={() => setEditing(null)}>
                      {hidden}
                      <input type="hidden" name="factId" value={fact.id} />
                      <Input name="topic" defaultValue={fact.topic} maxLength={40} aria-label="Topic" />
                      <Input name="text" defaultValue={fact.text} maxLength={200} aria-label="Fact" />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={savingFact}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  </li>
                ) : (
                  <li key={fact.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{fact.topic}</Badge>
                      <Badge variant={fact.origin === "owner" ? "success" : "secondary"}>
                        {fact.origin === "owner" ? "Written by you" : "From Knowledge"}
                      </Badge>
                      {fact.stale ? <Badge variant="warning">Hidden: source changed or removed</Badge> : null}
                    </div>
                    <p className="mt-2">{fact.text}</p>
                    {fact.sourceNames.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">Source: {fact.sourceNames.join(", ")}</p>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(fact.id)}>
                        Edit
                      </Button>
                      <form action={removeAction}>
                        {hidden}
                        <input type="hidden" name="factId" value={fact.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          Remove
                        </Button>
                      </form>
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </section>

        <form action={saveAction} className="flex flex-col gap-2 border-t border-border pt-4">
          {hidden}
          <p className="text-sm font-medium">Add a fact</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input name="topic" placeholder="Topic (e.g. email)" maxLength={40} className="sm:w-40" aria-label="Topic" />
            <Input name="text" placeholder="hello@example.com is the best way to reach us." maxLength={200} aria-label="Fact" />
            <Button type="submit" size="sm" disabled={savingFact}>
              Add
            </Button>
          </div>
          <Feedback state={saveState} />
        </form>
      </CardContent>
    </Card>
  );
}
