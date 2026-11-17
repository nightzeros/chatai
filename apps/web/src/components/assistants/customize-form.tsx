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

export function CustomizeForm({
  assistant,
  apiUrl,
  embedded = false,
}: {
  assistant: Assistant;
  apiUrl: string;
  /** When true, omit page header (used inside Widget hub). */
  embedded?: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateAssistantSettings, null);
  const [draft, setDraft] = useState<AssistantSettingsInput>(() => ({
    ...assistant.settings,
    position: assistant.settings.position ?? "bottom-right",
    theme: assistant.settings.theme ?? "system",
    showSources: assistant.settings.showSources ?? true,
    voiceAppearance: {
      experience: assistant.settings.voiceAppearance?.experience ?? "classic",
      captionsDefault: assistant.settings.voiceAppearance?.captionsDefault ?? true,
      motion: assistant.settings.voiceAppearance?.motion ?? "system",
      ...(assistant.settings.voiceAppearance?.accentColor
        ? { accentColor: assistant.settings.voiceAppearance.accentColor }
        : {}),
    },
  }));
  const [preview, setPreview] = useState(draft);
  const questions = [...(draft.suggestedQuestions ?? []), ...Array(QUESTION_SLOTS)].slice(0, QUESTION_SLOTS);
  const voiceExperience = draft.voiceAppearance?.experience ?? "classic";
  const voiceCaptions = draft.voiceAppearance?.captionsDefault ?? true;
  const voiceMotion = draft.voiceAppearance?.motion ?? "system";

  useEffect(() => {
    setDraft({
      ...assistant.settings,
      position: assistant.settings.position ?? "bottom-right",
      theme: assistant.settings.theme ?? "system",
      showSources: assistant.settings.showSources ?? true,
      voiceAppearance: {
        experience: assistant.settings.voiceAppearance?.experience ?? "classic",
        captionsDefault: assistant.settings.voiceAppearance?.captionsDefault ?? true,
        motion: assistant.settings.voiceAppearance?.motion ?? "system",
        ...(assistant.settings.voiceAppearance?.accentColor
          ? { accentColor: assistant.settings.voiceAppearance.accentColor }
          : {}),
      },
    });
  }, [assistant.settings]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreview(draft), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft]);

  return (
    <div className="flex flex-col gap-6">
      {embedded ? null : (
        <PageHeader
          title="Customize"
          description="Tune appearance and suggested questions. The live preview updates after a short pause while you type."
        />
      )}
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
                <legend className="text-sm font-medium">Voice experience</legend>
                <p className="text-sm text-muted-foreground">
                  Classic keeps the mic-in-composer waveform. Orb, Guided, Companion, and Side panel
                  use a voice stage inside the chat panel. Dock adds a Talk control beside the
                  launcher. Captions default applies to those stage experiences — not Classic.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      {
                        value: "classic" as const,
                        title: "Classic",
                        blurb: "Mic toggle and waveform strip — existing layout.",
                      },
                      {
                        value: "orb" as const,
                        title: "Orb",
                        blurb: "Centered sphere stage with mute, captions, and call controls.",
                      },
                      {
                        value: "dock" as const,
                        title: "Dock",
                        blurb: "Talk control expands into a compact voice card beside the launcher.",
                      },
                      {
                        value: "guided" as const,
                        title: "Guided",
                        blurb: "Welcome canvas with your assistant name and real suggested questions.",
                      },
                      {
                        value: "companion" as const,
                        title: "Companion",
                        blurb: "Abstract character stage with your assistant name and welcome speech.",
                      },
                      {
                        value: "side-panel" as const,
                        title: "Side panel",
                        blurb: "Tall edge sheet beside the page with transcript and shared voice stage.",
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer flex-col gap-1 rounded-lg border border-border p-3 has-[:checked]:border-foreground"
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="voiceExperience"
                          value={option.value}
                          checked={voiceExperience === option.value}
                          onChange={() =>
                            setDraft((current) => ({
                              ...current,
                              voiceAppearance: {
                                ...current.voiceAppearance,
                                experience: option.value,
                              },
                            }))
                          }
                        />
                        <span className="text-sm font-medium">{option.title}</span>
                      </span>
                      <span className="pl-7 text-xs text-muted-foreground">{option.blurb}</span>
                    </label>
                  ))}
                </div>
                <label
                  className={`flex items-start gap-3 rounded-lg border border-border p-3 ${
                    voiceExperience === "classic" ? "opacity-60" : "has-[:checked]:border-foreground"
                  }`}
                >
                  <input
                    type="hidden"
                    name="voiceCaptionsDefault"
                    value={voiceCaptions ? "on" : "off"}
                  />
                  <input
                    type="checkbox"
                    checked={voiceCaptions}
                    disabled={voiceExperience === "classic"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        voiceAppearance: {
                          ...current.voiceAppearance,
                          captionsDefault: event.target.checked,
                        },
                      }))
                    }
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">Show captions by default</span>
                    <span className="block text-sm text-muted-foreground">
                      Orb, Dock, Guided, Companion, and Side panel captions only — Classic transcript
                      layout is unchanged.
                    </span>
                  </span>
                </label>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="voiceMotion">Motion</Label>
                  <select
                    id="voiceMotion"
                    name="voiceMotion"
                    value={voiceMotion}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        voiceAppearance: {
                          ...current.voiceAppearance,
                          motion: event.target.value as "system" | "reduced",
                        },
                      }))
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="system">Follow system preference</option>
                    <option value="reduced">Reduced motion</option>
                  </select>
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

        <WidgetPreview
          assistantId={assistant.publicId}
          apiUrl={apiUrl}
          settings={preview}
          assistantName={assistant.name}
          playgroundHref={`/dashboard/assistants/${assistant.id}/playground`}
        />
      </div>
    </div>
  );
}
