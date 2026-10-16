/** @jsxImportSource preact */
import type {
  ResolvedVoiceAppearance,
  WidgetMessage,
  WidgetVoiceState,
} from "@nightzeros/chatai-widget-core";

import { VoiceBar } from "../voice-ui";
import { VoiceGuidedStage } from "./voice-guided";
import { voiceStageVisible } from "./voice-presentation";
import { VoiceStage } from "./voice-stage";

/**
 * Routes Classic / Orb / Guided / Companion / Side-panel stage content inside the chat panel.
 * Dock uses `VoiceDock` beside the launcher (mutual exclusion with the chat panel).
 */
export function VoiceExperience({
  appearance,
  assistantName,
  voice,
  messages,
  levels,
  captionsOpen,
  questions = [],
  onStart,
  onEnd,
  onMute,
  onToggleCaptions,
  onRetry,
  onDismiss,
  onAcceptConsent,
  onDeclineConsent,
}: {
  appearance: ResolvedVoiceAppearance;
  assistantName: string;
  voice: WidgetVoiceState;
  messages: WidgetMessage[];
  levels: () => { input: number; output: number };
  captionsOpen: boolean;
  questions?: string[];
  onStart: () => void;
  onEnd: () => void;
  onMute: (muted: boolean) => void;
  onToggleCaptions: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onAcceptConsent: () => void;
  onDeclineConsent: () => void;
}) {
  if (appearance.experience === "guided" && voiceStageVisible(voice)) {
    return (
      <VoiceGuidedStage
        appearance={appearance}
        assistantName={assistantName}
        voice={voice}
        messages={messages}
        levels={levels}
        captionsOpen={captionsOpen}
        questions={questions}
        onStart={onStart}
        onEnd={onEnd}
        onMute={onMute}
        onToggleCaptions={onToggleCaptions}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onAcceptConsent={onAcceptConsent}
        onDeclineConsent={onDeclineConsent}
      />
    );
  }

  if (appearance.experience === "companion" && voiceStageVisible(voice)) {
    return (
      <VoiceStage
        assistantName={assistantName}
        voice={voice}
        messages={messages}
        levels={levels}
        captionsOpen={captionsOpen}
        layout="orb"
        visual="companion"
        reducedMotion={appearance.motion === "reduced"}
        accentColor={appearance.accentColor}
        onStart={onStart}
        onEnd={onEnd}
        onMute={onMute}
        onToggleCaptions={onToggleCaptions}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onAcceptConsent={onAcceptConsent}
        onDeclineConsent={onDeclineConsent}
      />
    );
  }

  if (
    (appearance.experience === "orb" || appearance.experience === "side-panel") &&
    voiceStageVisible(voice)
  ) {
    return (
      <VoiceStage
        assistantName={assistantName}
        voice={voice}
        messages={messages}
        levels={levels}
        captionsOpen={captionsOpen}
        layout="orb"
        reducedMotion={appearance.motion === "reduced"}
        accentColor={appearance.accentColor}
        onStart={onStart}
        onEnd={onEnd}
        onMute={onMute}
        onToggleCaptions={onToggleCaptions}
        onRetry={onRetry}
        onDismiss={onDismiss}
        onAcceptConsent={onAcceptConsent}
        onDeclineConsent={onDeclineConsent}
      />
    );
  }

  if (appearance.experience === "classic") {
    return (
      <VoiceBar voice={voice} levels={levels} onRetry={onRetry} onDismiss={onDismiss} />
    );
  }

  return null;
}

export { voiceStageVisible } from "./voice-presentation";
