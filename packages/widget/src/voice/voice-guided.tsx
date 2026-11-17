/** @jsxImportSource preact */
import type {
  ResolvedVoiceAppearance,
  WidgetMessage,
  WidgetVoiceState,
} from "@nightzeros/chatai-widget-core";
import { isVoiceActive } from "@nightzeros/chatai-widget-core";

import { VoiceStage } from "./voice-stage";

/**
 * Guided idle canvas: assistant configured name, welcome, real suggested questions.
 * Questions call the text send path while Voice is off — never injected into a live session.
 */
export function VoiceGuidedCanvas({
  assistantName,
  welcomeMessage,
  questions,
  voiceOffered,
  busy,
  onStart,
  onAsk,
}: {
  assistantName: string;
  welcomeMessage?: string;
  questions: string[];
  voiceOffered: boolean;
  busy: boolean;
  onStart: () => void;
  onAsk: (question: string) => void;
}) {
  return (
    <div className="chatai-guided">
      <p className="chatai-guided-kicker">Live voice guide</p>
      <h3 className="chatai-guided-title">{assistantName}</h3>
      {welcomeMessage ? <p className="chatai-guided-welcome">{welcomeMessage}</p> : null}

      {questions.length > 0 ? (
        <div className="chatai-guided-choices">
          <p className="chatai-guided-choices-label">Suggested questions</p>
          {questions.map((question) => (
            <button
              key={question}
              type="button"
              className="chatai-guided-choice"
              onClick={() => onAsk(question)}
              disabled={busy}
            >
              <span>{question}</span>
              <span className="chatai-guided-choice-mark" aria-hidden="true">
                ↗
              </span>
            </button>
          ))}
          <p className="chatai-guided-hint">Tap a question to ask by text, or start voice below.</p>
        </div>
      ) : (
        <p className="chatai-guided-hint">Start a voice conversation when you are ready.</p>
      )}

      {voiceOffered ? (
        <button type="button" className="chatai-voice-primary chatai-guided-start" onClick={onStart}>
          Start conversation
        </button>
      ) : null}
    </div>
  );
}

/** Speak-examples while Guided Voice is live — not clickable into the provider session. */
export function VoiceGuidedSpeakHints({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <div className="chatai-guided-speak-hints">
      <p className="chatai-guided-choices-label">Try saying</p>
      <ul>
        {questions.slice(0, 4).map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Guided active stage: shared VoiceStage plus optional speak hints (voice inactive questions
 * are handled by VoiceGuidedCanvas).
 */
export function VoiceGuidedStage({
  appearance,
  assistantName,
  voice,
  messages,
  levels,
  captionsOpen,
  questions,
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
  questions: string[];
  onStart: () => void;
  onEnd: () => void;
  onMute: (muted: boolean) => void;
  onToggleCaptions: () => void;
  onRetry: () => void;
  onDismiss: () => void;
  onAcceptConsent: () => void;
  onDeclineConsent: () => void;
}) {
  const showHints =
    isVoiceActive(voice.connection) &&
    voice.connection === "connected" &&
    !voice.consentPending &&
    questions.length > 0;

  return (
    <div className="chatai-guided-stage">
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
      {showHints ? <VoiceGuidedSpeakHints questions={questions} /> : null}
    </div>
  );
}
