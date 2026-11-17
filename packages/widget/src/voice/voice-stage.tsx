/** @jsxImportSource preact */
import type { WidgetMessage, WidgetVoiceState } from "@nightzeros/chatai-widget-core";

import { VoiceConsent } from "../voice-ui";
import { VoiceCaptions } from "./voice-captions";
import { VoiceCompanionCharacter } from "./voice-companion";
import { VoiceControls } from "./voice-controls";
import { VoiceOrb } from "./voice-orb";
import { presentVoice, type VoicePresentation } from "./voice-presentation";

export type VoiceStageLayout = "orb" | "compact";
export type VoiceStageVisual = "orb" | "companion";

export function VoiceStage({
  assistantName,
  voice,
  messages,
  levels,
  captionsOpen,
  layout = "orb",
  visual = "orb",
  reducedMotion,
  accentColor,
  onStart,
  onEnd,
  onMute,
  onToggleCaptions,
  onRetry,
  onDismiss,
  onAcceptConsent,
  onDeclineConsent,
}: {
  assistantName: string;
  voice: WidgetVoiceState;
  messages: WidgetMessage[];
  levels: () => { input: number; output: number };
  captionsOpen: boolean;
  layout?: VoiceStageLayout;
  visual?: VoiceStageVisual;
  reducedMotion?: boolean;
  accentColor?: string;
  onStart: () => void;
  onEnd: () => void;
  onMute: (muted: boolean) => void;
  onToggleCaptions: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onAcceptConsent: () => void;
  onDeclineConsent: () => void;
}) {
  const presentation: VoicePresentation = presentVoice(voice);
  const statusId = "chatai-voice-stage-status";
  const companion = visual === "companion";

  return (
    <div
      className={`chatai-voice-stage layout-${layout}${companion ? " visual-companion" : ""}`}
      data-phase={voice.phase}
      data-motion={presentation.motion}
      style={
        accentColor
          ? ({ "--chatai-voice-accent": accentColor } as Record<string, string>)
          : undefined
      }
    >
      <p className="chatai-voice-identity">
        <span className="chatai-kicker">{companion ? "Live companion" : "Live voice"}</span>
        <span className="chatai-voice-name">{assistantName}</span>
      </p>

      {companion ? (
        <VoiceCompanionCharacter
          motion={presentation.motion}
          levels={levels}
          reducedMotion={reducedMotion}
        />
      ) : (
        <VoiceOrb motion={presentation.motion} levels={levels} reducedMotion={reducedMotion} />
      )}

      <p id={statusId} className="chatai-voice-stage-status" role="status" aria-live="polite">
        {presentation.status}
      </p>
      {presentation.errorMessage ? (
        <p className="chatai-voice-stage-detail" role="alert">
          {presentation.errorMessage}
        </p>
      ) : null}
      {presentation.notice ? (
        <p className="chatai-voice-stage-detail">{presentation.notice}</p>
      ) : null}
      {presentation.meta ? <p className="chatai-voice-stage-meta">{presentation.meta}</p> : null}

      {presentation.consentPending ? (
        <VoiceConsent onAccept={onAcceptConsent} onCancel={onDeclineConsent} />
      ) : (
        <>
          <VoiceCaptions messages={messages} open={captionsOpen} />
          <VoiceControls
            presentation={presentation}
            captionsOpen={captionsOpen}
            onStart={onStart}
            onEnd={onEnd}
            onMute={onMute}
            onToggleCaptions={onToggleCaptions}
            onRetry={onRetry}
            onDismiss={onDismiss}
          />
        </>
      )}
    </div>
  );
}
