"use client";

import { useActionState, useEffect, useState } from "react";

import { updateAssistantSettings } from "@/app/dashboard/actions";
import { WidgetPreview } from "@/components/assistants/widget-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import type { AssistantSettingsInput } from "@/lib/assistant-settings";
import type { Assistant } from "@/lib/assistants";

const QUESTION_SLOTS = 5;
const PREVIEW_DEBOUNCE_MS = 350;

export function CustomizeForm({ assistant, apiUrl }: { assistant: Assistant; apiUrl: string }) {
  const [state, formAction, pending] = useActionState(updateAssistantSettings, null);
  const [draft, setDraft] = useState<AssistantSettingsInput>(() => ({
    ...assistant.settings,
    position: assistant.settings.position ?? "bottom-right",
    theme: assistant.settings.theme ?? "system",
    showSources: assistant.settings.showSources ?? true,
  }));
  const [preview, setPreview] = useState(draft);
  const questions = [...(draft.suggestedQuestions ?? []), ...Array(QUESTION_SLOTS)].slice(0, QUESTION_SLOTS);

  useEffect(() => {
    setDraft({
      ...assistant.settings,
      position: assistant.settings.position ?? "bottom-right",
      theme: assistant.settings.theme ?? "system",
      showSources: assistant.settings.showSources ?? true,
    });
  }, [assistant.settings]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreview(draft), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customize"
        description="Tune appearance and suggested questions. The live preview updates after a short pause while you type."
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Widget appearance</CardTitle>
            <CardDescription>Choose how your assistant appears on a visitor&apos;s site.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="flex flex-col gap-7">
              <input type="hidden" name="id" value={assistant.id} />

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium">Appearance</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="primaryColor">Accent color</Label>
                    <div className="flex items-center gap-2">
                      <input
                        id="primaryColorPicker"
                        type="color"
                        value={/^#[0-9A-Fa-f]{6}$/.test(draft.primaryColor ?? "") ? draft.primaryColor! : "#171717"}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, primaryColor: event.target.value.toUpperCase() }))
                        }
                        className="h-9 w-11 cursor-pointer rounded-md border border-input bg-transparent p-1"
                        aria-label="Pick color"
                      />
                      <Input
                        id="primaryColor"
                        name="primaryColor"
                        value={draft.primaryColor ?? ""}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, primaryColor: event.target.value }))
                        }
                        maxLength={7}
                        placeholder="#171717"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="iconUrl">Launcher icon URL</Label>
                    <Input
                      id="iconUrl"
                      name="iconUrl"
                      type="url"
                      value={draft.iconUrl ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, iconUrl: event.target.value || null }))
                      }
                      placeholder="https://example.com/icon.svg"
                    />
                  </div>
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium">Widget placement</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(["bottom-right", "bottom-left"] as const).map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground"
                    >
                      <input
                        type="radio"
                        name="position"
                        value={value}
                        checked={draft.position === value}
                        onChange={() => setDraft((current) => ({ ...current, position: value }))}
                      />
                      <span className="text-sm font-medium">
                        {value === "bottom-right" ? "Bottom right" : "Bottom left"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium">Color mode</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(["system", "light", "dark"] as const).map((value) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 capitalize has-[:checked]:border-foreground"
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={value}
                        checked={draft.theme === value}
                        onChange={() => setDraft((current) => ({ ...current, theme: value }))}
                      />
                      <span className="text-sm font-medium">{value}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-medium">Suggested questions</legend>
                <p className="text-sm text-muted-foreground">
                  Show up to five prompts before a visitor starts chatting.
                </p>
                <div className="flex flex-col gap-2">
                  {questions.map((question, index) => (
                    <Input
                      key={index}
                      name="suggestedQuestions"
                      value={question ?? ""}
                      onChange={(event) =>
                        setDraft((current) => {
                          const suggestedQuestions = [...(current.suggestedQuestions ?? [])];
                          suggestedQuestions[index] = event.target.value;
                          return { ...current, suggestedQuestions };
                        })
                      }
                      maxLength={160}
                      placeholder={index === 0 ? "What can you help me with?" : "Optional question"}
                    />
                  ))}
                </div>
              </fieldset>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-foreground">
                <input
                  type="checkbox"
                  name="showSources"
                  checked={draft.showSources ?? true}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, showSources: event.target.checked }))
                  }
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">Show sources</span>
                  <span className="block text-sm text-muted-foreground">
                    Display document names and pages beneath cited answers.
                  </span>
                </span>
              </label>

              {state && "error" in state ? <p className="text-sm text-destructive">{state.error}</p> : null}
              {state && "saved" in state ? (
                <p className="text-sm text-muted-foreground">Widget settings saved.</p>
              ) : null}
              <Button type="submit" disabled={pending} className="w-fit">
                {pending ? "Saving…" : "Save widget settings"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <WidgetPreview assistantId={assistant.publicId} apiUrl={apiUrl} settings={preview} />
      </div>
    </div>
  );
}
