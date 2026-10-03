/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";
import {
  isVoiceActive,
  VOICE_PHASE_LABELS,
  type WidgetVoiceState,
} from "@nightzeros/chatai-widget-core";

const BAR_WEIGHTS = [0.55, 0.85, 1, 0.8, 0.5];

export function MicGlyph({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      {off ? (
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
      ) : (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke-linecap="round" />
        </>
      )}
    </svg>
  );
}

export function VoiceGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4">
      <path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2" stroke-linecap="round" />
    </svg>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function Waveform({
  phase,
  active,
  levels,
}: {
  phase: WidgetVoiceState["phase"];
  active: boolean;
  levels: () => { input: number; output: number };
}) {
  const bars = useRef<Array<HTMLSpanElement | null>>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    if (!active || prefersReducedMotion() || typeof requestAnimationFrame === "undefined") return;
    let frame = 0;
    const draw = () => {
      const { input, output } = levels();
      const current = phaseRef.current;
      const level =
        current === "user_speaking" ? input : current === "assistant_speaking" ? output : 0;
      const energy = Math.min(1, level * 8);
      bars.current.forEach((bar, index) => {
        if (!bar) return;
        const weight = BAR_WEIGHTS[index] ?? 0.6;
        bar.style.transform = `scaleY(${(0.22 + energy * weight * 0.78).toFixed(3)})`;
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      bars.current.forEach((bar) => bar?.style.removeProperty("transform"));
    };
  }, [active, levels]);

  return (
    <span className="chatai-wave" aria-hidden="true">
      {BAR_WEIGHTS.map((_, index) => (
        <span
          key={index}
          ref={(el) => {
            bars.current[index] = el;
          }}
        />
      ))}
    </span>
  );
}

function voiceMeta(voice: WidgetVoiceState): string {
  if (voice.mock) return "Test mode · no audio";
  if (voice.ephemeral) return "Not saved";
  const parts = [
    voice.recording ? "Recording" : "",
    voice.transcriptSaved === false ? "Voice transcript not saved" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Recording disclosure shown before the microphone is requested. Escape or
 * Cancel returns to text chat without starting anything.
 */
export function VoiceConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className="chatai-voice-consent"
      role="group"
      tabIndex={-1}
      aria-labelledby="chatai-voice-consent-title"
      aria-describedby="chatai-voice-consent-text"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <p id="chatai-voice-consent-title" className="chatai-voice-consent-title">
        This voice conversation is recorded
      </p>
      <p id="chatai-voice-consent-text" className="chatai-voice-consent-text">
        Audio of the call, your voice and the assistant's, is saved for the site owner to review.
        Your microphone turns on only after you agree.
      </p>
      <div className="chatai-voice-actions">
        <button type="button" className="chatai-consent-accept" onClick={onAccept}>
          Agree and start
        </button>
        <button type="button" className="chatai-consent-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function VoiceBar({
  voice,
  levels,
  onRetry,
  onDismiss,
}: {
  voice: WidgetVoiceState;
  levels: () => { input: number; output: number };
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const active = isVoiceActive(voice.connection);
  const failed = voice.connection === "failed";
  const label = VOICE_PHASE_LABELS[voice.phase];
  const notice = voice.connection === "ended" ? voice.notice : undefined;
  const status = failed && voice.error ? `${label}. ${voice.error.message}` : active ? label : (notice ?? "");

  return (
    <>
      <p className="chatai-visually-hidden" role="status" aria-live="polite">
        {status}
      </p>
      {active || failed ? (
        <div className={`chatai-voice-bar${failed ? " is-error" : ""}`} data-phase={voice.phase}>
          {failed ? (
            <>
              <p className="chatai-voice-error">{voice.error?.message ?? label}</p>
              <div className="chatai-voice-actions">
                {voice.error?.code !== "unsupported" ? (
                  <button type="button" className="chatai-retry" onClick={onRetry}>
                    Try again
                  </button>
                ) : null}
                <button type="button" className="chatai-retry" onClick={onDismiss}>
                  Keep typing
                </button>
              </div>
            </>
          ) : (
            <>
              <Waveform phase={voice.phase} active={active} levels={levels} />
              <span className="chatai-voice-label">{label}</span>
              <span className="chatai-voice-meta">{voiceMeta(voice)}</span>
            </>
          )}
        </div>
      ) : notice ? (
        <div className="chatai-voice-bar is-notice" data-phase={voice.phase}>
          <p className="chatai-voice-error">{notice}</p>
          <div className="chatai-voice-actions">
            <button type="button" className="chatai-retry" onClick={onDismiss}>
              OK
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
