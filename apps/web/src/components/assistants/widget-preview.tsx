"use client";

import Link from "next/link";
import { useState } from "react";

import { ChatWidget } from "@nightzeros/chatai-react";

import { VoiceDesignPreview } from "@/components/assistants/voice-design-preview";
import type { AssistantSettingsInput } from "@/lib/assistant-settings";
import { previewWidgetOptions } from "@/lib/widget-preview";

type PreviewWidgetInput = {
  assistantId: string;
  apiUrl: string;
  settings: AssistantSettingsInput;
  assistantName: string;
  playgroundHref: string;
};

type PreviewMode = "design" | "live";

export function WidgetPreview({
  assistantId,
  apiUrl,
  settings,
  assistantName,
  playgroundHref,
}: PreviewWidgetInput) {
  const [mode, setMode] = useState<PreviewMode>("design");
  const experience = settings.voiceAppearance?.experience ?? "classic";
  const showStageSim =
    (experience === "orb" ||
      experience === "dock" ||
      experience === "guided" ||
      experience === "companion" ||
      experience === "side-panel") &&
    mode === "design";
  const accent =
    settings.voiceAppearance?.accentColor ?? settings.primaryColor ?? "#0F766E";
  const tall =
    experience === "orb" ||
    experience === "dock" ||
    experience === "guided" ||
    experience === "companion" ||
    experience === "side-panel" ||
    mode === "live";

  return (
    <aside className="rounded-xl border border-border bg-muted/30 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Draft preview
      </p>
      <div className="mt-3 flex gap-2" role="group" aria-label="Preview mode">
        <button
          type="button"
          className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
            mode === "design" ? "border-foreground bg-foreground text-background" : "border-border"
          }`}
          onClick={() => setMode("design")}
        >
          Design
        </button>
        <button
          type="button"
          className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
            mode === "live" ? "border-foreground bg-foreground text-background" : "border-border"
          }`}
          onClick={() => setMode("live")}
        >
          Live microphone
        </button>
      </div>

      {showStageSim ? (
        <div className="mt-5">
          <VoiceDesignPreview
            assistantName={assistantName}
            accentColor={accent}
            captionsDefault={settings.voiceAppearance?.captionsDefault ?? true}
            layout={experience === "dock" ? "compact" : "orb"}
            guided={experience === "guided"}
            companion={experience === "companion"}
            sidePanel={experience === "side-panel"}
            suggestedQuestions={settings.suggestedQuestions}
          />
        </div>
      ) : (
        <div
          className={`relative mt-5 overflow-hidden rounded-lg border border-border bg-background ${
            tall ? (experience === "side-panel" ? "h-[36rem]" : "h-[32rem]") : "h-96"
          }`}
        >
          <div className="absolute inset-0" data-testid="widget-preview-mount">
            <ChatWidget
              className="h-full w-full"
              {...previewWidgetOptions({
                assistantId,
                apiUrl,
                settings,
                voice: mode === "live",
              })}
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-sm text-muted-foreground">
        {mode === "design"
          ? showStageSim
            ? `Design preview — simulated ${
                experience === "dock"
                  ? "Dock"
                  : experience === "guided"
                    ? "Guided"
                    : experience === "companion"
                      ? "Companion"
                      : experience === "side-panel"
                        ? "Side panel"
                        : "Orb"
              } phases. No microphone.`
            : "Design preview — Voice is off so the mic is never requested."
          : "Live microphone — real visitor widget with your draft Voice experience."}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Owner diagnostics (retrieval, gate, recordings) stay in the{" "}
        <Link href={playgroundHref} className="font-medium text-foreground underline underline-offset-2">
          Playground
        </Link>
        . Use <span className="font-medium text-foreground">Live microphone</span> here to see the
        visitor experience.
      </p>
    </aside>
  );
}
