"use client";

import { ChatWidget } from "@nightzeros/chatai-react";

import type { AssistantSettingsInput } from "@/lib/assistant-settings";
import { previewWidgetOptions } from "@/lib/widget-preview";

/**
 * Real embeddable widget for owners to verify Customize / Voice experience
 * (Classic waveform vs Orb stage) with a microphone. Separate from the owner
 * VoicePanel diagnostics strip above the playground transcript.
 */
export function VisitorWidgetPanel({
  publicId,
  apiUrl,
  settings,
}: {
  publicId: string;
  apiUrl: string;
  settings: AssistantSettingsInput;
}) {
  const experience = settings.voiceAppearance?.experience ?? "classic";

  return (
    <section className="rounded-xl border border-border bg-muted/20 p-4">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Visitor widget</h3>
          <p className="text-xs text-muted-foreground">
            Same surface as your embed. Voice experience:{" "}
            <span className="font-medium text-foreground">
              {experience === "orb"
                ? "Orb"
                : experience === "dock"
                  ? "Dock"
                  : experience === "guided"
                    ? "Guided"
                    : experience === "companion"
                      ? "Companion"
                      : experience === "side-panel"
                        ? "Side panel"
                        : "Classic"}
            </span>
            {experience === "orb"
              ? " — start Voice to replace the chat with the orb stage."
              : experience === "dock"
                ? " — use Talk (not the chat mic) to open the compact voice card."
                : experience === "guided"
                  ? " — open chat for the welcome canvas, then Start conversation."
                  : experience === "companion"
                    ? " — open chat for the companion character, then Start conversation."
                    : experience === "side-panel"
                      ? " — tall edge panel beside the page; start Voice for the shared stage."
                      : " — mic + waveform in the composer."}
          </p>
        </div>
      </div>
      <div className="relative h-[32rem] overflow-hidden rounded-lg border border-border bg-background">
        <div className="absolute inset-0">
          <ChatWidget
            className="h-full w-full"
            {...previewWidgetOptions({
              assistantId: publicId,
              apiUrl,
              settings,
              voice: true,
            })}
          />
        </div>
      </div>
    </section>
  );
}
