"use client";

import { useActionState, useState } from "react";

import {
  clearPurpose,
  dismissPurposeSuggestion,
  requestPurposeSuggestion,
  savePurpose,
  type ProfileActionState,
} from "@/app/dashboard/assistants/[id]/profile/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PurposeFields = { summary: string; represents: string; redirect: string; mode: "focused" | "general" };

type Props = {
  assistantId: string;
  version: number | null;
  purpose: (PurposeFields & { confirmedAt: string | null; instructionsChanged: boolean }) | null;
  suggestion: (Omit<PurposeFields, "mode"> & { basis: "instructions" | "knowledge" }) | null;
  /** Where the enforced domain currently comes from. */
  enforcedSource: "owner" | "suggested" | "instructions" | "unconfigured";
};

const SOURCE_LABEL: Record<Props["enforcedSource"], string> = {
  owner: "Your saved Purpose",
  suggested: "Suggested Purpose (from your Instructions)",
  instructions: "Your Instructions (no Purpose saved)",
  unconfigured: "Assistant name and description only",
};

function Feedback({ state }: { state: ProfileActionState }) {
  if (!state) return null;
  if ("error" in state) return <p className="text-sm text-destructive">{state.error}</p>;
  return state.message ? <p className="text-sm text-muted-foreground">{state.message}</p> : null;
}

export function ProfilePurposeCard({ assistantId, version, purpose, suggestion, enforcedSource }: Props) {
  const [fields, setFields] = useState<PurposeFields>({
    summary: purpose?.summary ?? "",
    represents: purpose?.represents ?? "",
    redirect: purpose?.redirect ?? "",
    mode: purpose?.mode ?? "focused",
  });
  const [saveState, saveAction, saving] = useActionState<ProfileActionState, FormData>(savePurpose, null);
  const [suggestState, suggestAction, suggesting] = useActionState<ProfileActionState, FormData>(
    requestPurposeSuggestion,
    null,
  );
  const [, dismissAction] = useActionState<ProfileActionState, FormData>(dismissPurposeSuggestion, null);
  const [clearState, clearAction, clearing] = useActionState<ProfileActionState, FormData>(clearPurpose, null);
  const hidden = (
    <>
      <input type="hidden" name="id" value={assistantId} />
      <input type="hidden" name="version" value={version ?? ""} />
    </>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Purpose</CardTitle>
        <CardDescription>
          The Purpose is the only thing that decides which topics this assistant helps with, in Text and
          Voice. Your Instructions can narrow it further. Knowledge and Key facts never widen or narrow it:
          unrelated requests get a short, friendly redirect.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Currently enforced:</span>
          <Badge variant={enforcedSource === "owner" ? "success" : "secondary"}>{SOURCE_LABEL[enforcedSource]}</Badge>
          {purpose?.instructionsChanged ? (
            <Badge variant="warning">Instructions changed since this Purpose was saved</Badge>
          ) : null}
        </div>

        {suggestion ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              Suggested Purpose{" "}
              <span className="font-normal text-muted-foreground">
                (drafted from your {suggestion.basis === "instructions" ? "Instructions" : "Knowledge titles"}; not
                used until you save it)
              </span>
            </p>
            <p className="mt-2">{suggestion.summary}</p>
            {suggestion.redirect ? <p className="mt-1 text-muted-foreground">Redirect: {suggestion.redirect}</p> : null}
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setFields({
                    summary: suggestion.summary,
                    represents: suggestion.represents ?? "",
                    redirect: suggestion.redirect ?? "",
                    mode: "focused",
                  })
                }
              >
                Copy into the form
              </Button>
              <form action={dismissAction}>
                {hidden}
                <Button type="submit" size="sm" variant="ghost">
                  Dismiss
                </Button>
              </form>
            </div>
          </div>
        ) : null}

        <form action={saveAction} className="flex flex-col gap-4">
          {hidden}
          <div className="flex flex-col gap-2">
            <Label htmlFor="purpose-summary">What does this assistant help visitors with?</Label>
            <Textarea
              id="purpose-summary"
              name="summary"
              rows={4}
              value={fields.summary}
              onChange={(event) => setFields({ ...fields, summary: event.target.value })}
              placeholder="Helps visitors learn about Jane's software projects, experience and availability for freelance work."
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purpose-represents">Represents (optional)</Label>
            <Input
              id="purpose-represents"
              name="represents"
              value={fields.represents}
              onChange={(event) => setFields({ ...fields, represents: event.target.value })}
              placeholder="Jane Doe"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="purpose-redirect">Redirect for unrelated requests (optional)</Label>
            <Input
              id="purpose-redirect"
              name="redirect"
              value={fields.redirect}
              onChange={(event) => setFields({ ...fields, redirect: event.target.value })}
              placeholder="I can help with questions about Jane's work and projects. What would you like to know?"
            />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="mode"
              value="general"
              checked={fields.mode === "general"}
              onChange={(event) => setFields({ ...fields, mode: event.target.checked ? "general" : "focused" })}
              className="mt-1"
            />
            <span>
              <span className="font-medium">General assistant: allow any topic</span>
              <span className="mt-1 block text-muted-foreground">
                Only for assistants meant to help with anything. Leave off to keep the assistant focused on its
                Purpose.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Purpose"}
            </Button>
            <Feedback state={saveState} />
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <form action={suggestAction}>
            {hidden}
            <Button type="submit" variant="outline" size="sm" disabled={suggesting}>
              {suggesting ? "Drafting…" : "Suggest a Purpose"}
            </Button>
          </form>
          {purpose ? (
            <form action={clearAction}>
              {hidden}
              <Button type="submit" variant="ghost" size="sm" disabled={clearing}>
                Clear Purpose
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
