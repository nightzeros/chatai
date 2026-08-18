"use client";

import { useActionState } from "react";
import { defaultRagSettings } from "@chatai/database/rag-settings";

import { deleteAssistant, updateAssistant } from "@/app/dashboard/actions";
import type { Assistant } from "@/lib/assistants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MODES = [
  {
    value: "strict",
    title: "Strict",
    description: "Only answers when reliable supporting knowledge exists. Otherwise it refuses.",
  },
  {
    value: "balanced",
    title: "Balanced",
    description: "Uses your knowledge first, but can answer simple general questions when appropriate.",
  },
  {
    value: "flexible",
    title: "Flexible",
    description: "More freedom to use general model knowledge alongside your sources.",
  },
] as const;

const CHUNKING_MODES = [
  {
    value: "standard",
    title: "Standard",
    description: "Single ~500-token chunks. Best default for most knowledge bases.",
  },
  {
    value: "parent_child",
    title: "Parent / child",
    description:
      "Embed smaller child chunks for retrieval, but feed wider parent passages to the model. Reprocess documents after changing this.",
  },
] as const;

export function SettingsForm({ assistant }: { assistant: Assistant }) {
  const [state, formAction, pending] = useActionState(updateAssistant, null);
  const rag = {
    ...defaultRagSettings,
    ...assistant.ragSettings,
    guardrails: {
      ...defaultRagSettings.guardrails,
      ...assistant.ragSettings?.guardrails,
    },
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Assistant</CardTitle>
          <CardDescription>Public ID: {assistant.publicId}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={assistant.id} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={80} defaultValue={assistant.name} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                maxLength={500}
                defaultValue={assistant.description ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="welcomeMessage">Welcome message</Label>
              <Input
                id="welcomeMessage"
                name="welcomeMessage"
                maxLength={500}
                defaultValue={assistant.welcomeMessage}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="instructions">Instructions</Label>
              <Textarea
                id="instructions"
                name="instructions"
                maxLength={8000}
                className="min-h-36"
                defaultValue={assistant.instructions ?? ""}
              />
            </div>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Hallucination mode</legend>
              {MODES.map((mode) => (
                <label
                  key={mode.value}
                  className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground"
                >
                  <input
                    type="radio"
                    name="hallucinationMode"
                    value={mode.value}
                    defaultChecked={assistant.hallucinationMode === mode.value}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{mode.title}</span>
                    <span className="block text-sm text-muted-foreground">{mode.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Retrieval</legend>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input type="checkbox" name="hybridSearch" defaultChecked={rag.hybridSearch} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">Hybrid search</span>
                  <span className="block text-sm text-muted-foreground">
                    Combine vector search with keyword matching (default on).
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input type="checkbox" name="rerank" defaultChecked={rag.rerank} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium">Rerank results</span>
                  <span className="block text-sm text-muted-foreground">
                    Reorder the top retrieved passages before answering.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input
                  type="checkbox"
                  name="queryExpansion"
                  defaultChecked={rag.queryExpansion}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Query expansion</span>
                  <span className="block text-sm text-muted-foreground">
                    Add alternate phrasings for short questions.
                  </span>
                </span>
              </label>
            </fieldset>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Guardrails</legend>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input
                  type="checkbox"
                  name="requireContext"
                  defaultChecked={Boolean(rag.guardrails.requireContext)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Require retrieved context</span>
                  <span className="block text-sm text-muted-foreground">
                    Refuse when the knowledge base does not support the question.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input
                  type="checkbox"
                  name="verifyCitations"
                  defaultChecked={Boolean(rag.guardrails.verifyCitations)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Verify answers against sources</span>
                  <span className="block text-sm text-muted-foreground">
                    Check claims after generation and regenerate once if they fail.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input
                  type="checkbox"
                  name="refuseOnLowConfidence"
                  defaultChecked={Boolean(rag.guardrails.refuseOnLowConfidence)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Refuse on low confidence</span>
                  <span className="block text-sm text-muted-foreground">
                    Fall back instead of answering when retrieval confidence is low.
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="flex flex-col gap-2">
              <Label htmlFor="evalSampleRate">Online eval sample rate</Label>
              <Input
                id="evalSampleRate"
                name="evalSampleRate"
                type="number"
                min={0}
                max={1}
                step={0.01}
                defaultValue={rag.evalSampleRate}
              />
              <p className="text-sm text-muted-foreground">
                Fraction of production answers to score asynchronously (0–1). Uses your AI API key.
              </p>
            </div>
            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">Chunking mode</legend>
              <p className="text-sm text-muted-foreground">
                Changing chunking mode only affects newly processed documents. Use Reprocess in
                Knowledge to rebuild existing content.
              </p>
              {CHUNKING_MODES.map((mode) => (
                <label
                  key={mode.value}
                  className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground"
                >
                  <input
                    type="radio"
                    name="chunkingMode"
                    value={mode.value}
                    defaultChecked={rag.chunkingMode === mode.value}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{mode.title}</span>
                    <span className="block text-sm text-muted-foreground">{mode.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {state && "error" in state ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {state && "saved" in state ? <p className="text-sm text-muted-foreground">Saved.</p> : null}
            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Delete this assistant and all of its knowledge, conversations, and analytics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action={deleteAssistant}
            onSubmit={(event) => {
              if (!window.confirm(`Delete “${assistant.name}”? This cannot be undone.`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={assistant.id} />
            <Button type="submit" variant="destructive">
              Delete assistant
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
