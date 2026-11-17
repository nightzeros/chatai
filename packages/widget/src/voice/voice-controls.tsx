/** @jsxImportSource preact */
import { MicGlyph } from "../voice-ui";
import type { VoicePresentation } from "./voice-presentation";

export function VoiceControls({
  presentation,
  captionsOpen,
  onStart,
  onEnd,
  onMute,
  onToggleCaptions,
  onRetry,
  onDismiss,
}: {
  presentation: VoicePresentation;
  captionsOpen: boolean;
  onStart: () => void;
  onEnd: () => void;
  onMute: (muted: boolean) => void;
  onToggleCaptions: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { canStart, canEnd, canMute, canToggleCaptions, canRetry, canDismiss, microphoneMuted } =
    presentation;

  const startAgain = Boolean(presentation.notice || presentation.status === "Voice ended");

  return (
    <div className="chatai-voice-controls">
      {canStart ? (
        <button
          type="button"
          className="chatai-voice-primary"
          onClick={onStart}
          aria-label={startAgain ? "Start again" : "Start conversation"}
        >
          {startAgain ? (
            "Start again"
          ) : (
            <>
              <span className="chatai-voice-label-long">Start conversation</span>
              <span className="chatai-voice-label-short">Start</span>
            </>
          )}
        </button>
      ) : null}
      {canEnd ? (
        <button type="button" className="chatai-voice-danger" onClick={onEnd} aria-label="End voice">
          End
        </button>
      ) : null}
      {canMute ? (
        <button
          type="button"
          className={`chatai-voice-secondary${microphoneMuted ? " is-pressed" : ""}`}
          onClick={() => onMute(!microphoneMuted)}
          aria-pressed={microphoneMuted}
          aria-label={microphoneMuted ? "Unmute microphone" : "Mute microphone"}
        >
          <MicGlyph off={microphoneMuted} />
          <span>{microphoneMuted ? "Unmute" : "Mute"}</span>
        </button>
      ) : null}
      {canToggleCaptions ? (
        <button
          type="button"
          className={`chatai-voice-secondary${captionsOpen ? " is-pressed" : ""}`}
          onClick={onToggleCaptions}
          aria-pressed={captionsOpen}
          aria-label={captionsOpen ? "Hide captions" : "Show captions"}
        >
          <span className="chatai-voice-label-long">Captions</span>
          <span className="chatai-voice-label-short">CC</span>
        </button>
      ) : null}
      {canRetry ? (
        <button type="button" className="chatai-voice-primary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
      {canDismiss ? (
        <button type="button" className="chatai-voice-secondary" onClick={onDismiss}>
          {presentation.consentPending ? (
            "Cancel"
          ) : (
            <>
              <span className="chatai-voice-label-long">Back to chat</span>
              <span className="chatai-voice-label-short">Chat</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
