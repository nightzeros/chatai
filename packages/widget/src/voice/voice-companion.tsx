/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";

import type { VoiceMotion } from "./voice-presentation";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

/**
 * Abstract CSS companion character. Energy from `levels()` drives a small scale/tilt
 * when motion is hearing/speaking; reduced-motion stays static.
 */
export function VoiceCompanionCharacter({
  motion,
  levels,
  reducedMotion,
}: {
  motion: VoiceMotion;
  levels: () => { input: number; output: number };
  reducedMotion?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = reducedMotion || prefersReducedMotion();
    if (reduced || typeof requestAnimationFrame === "undefined") {
      el.style.removeProperty("--chatai-companion-energy");
      return;
    }

    let frame = 0;
    const draw = () => {
      const current = motionRef.current;
      let energy = 0;
      if (current === "hearing") {
        energy = Math.min(1, levels().input * 8);
      } else if (current === "speaking") {
        energy = Math.min(1, levels().output * 8);
      } else if (current === "processing" || current === "pending") {
        energy = 0.35;
      } else if (current === "listening") {
        energy = 0.12;
      }
      el.style.setProperty("--chatai-companion-energy", energy.toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      el.style.removeProperty("--chatai-companion-energy");
    };
  }, [levels, reducedMotion]);

  return (
    <div
      ref={ref}
      className="chatai-companion-character"
      data-motion={motion}
      aria-hidden="true"
    >
      <span className="chatai-companion-body" />
      <span className="chatai-companion-eye chatai-companion-eye-left" />
      <span className="chatai-companion-eye chatai-companion-eye-right" />
      <span className="chatai-companion-smile" />
      <span className="chatai-companion-foot chatai-companion-foot-left" />
      <span className="chatai-companion-foot chatai-companion-foot-right" />
    </div>
  );
}

/**
 * Idle companion canvas: assistant configured name, welcome speech, Start conversation.
 * No fabricated persona names or commerce actions.
 */
export function VoiceCompanionCanvas({
  assistantName,
  welcomeMessage,
  voiceOffered,
  onStart,
}: {
  assistantName: string;
  welcomeMessage?: string;
  voiceOffered: boolean;
  onStart: () => void;
}) {
  const speech =
    welcomeMessage?.trim() ||
    `Hi — I’m ${assistantName}. Ready when you are.`;

  return (
    <div className="chatai-companion">
      <p className="chatai-companion-kicker">Live companion</p>
      <h3 className="chatai-companion-title">{assistantName}</h3>
      <p className="chatai-companion-speech" aria-live="polite">
        {speech}
      </p>
      <VoiceCompanionCharacter
        motion="static"
        levels={() => ({ input: 0, output: 0 })}
        reducedMotion
      />
      {voiceOffered ? (
        <button
          type="button"
          className="chatai-voice-primary chatai-companion-start"
          onClick={onStart}
        >
          Start conversation
        </button>
      ) : null}
      <p className="chatai-companion-hint">Stylized companion · tap Start to talk</p>
    </div>
  );
}
