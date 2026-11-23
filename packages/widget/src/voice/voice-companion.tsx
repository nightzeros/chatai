/** @jsxImportSource preact */
import { useEffect, useRef } from "preact/hooks";

import type { VoiceMotion } from "./voice-presentation";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

function clearCompanionVars(el: HTMLDivElement) {
  el.style.removeProperty("--chatai-companion-energy");
  el.style.removeProperty("--chatai-companion-mouth");
  el.style.removeProperty("--chatai-companion-blink");
  el.style.removeProperty("--chatai-companion-peak");
}

/**
 * Abstract CSS companion character. Energy from `levels()` drives body, mouth,
 * eyes, and feet when motion is hearing/speaking; reduced-motion stays static.
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
      clearCompanionVars(el);
      return;
    }

    let frame = 0;
    let smoothed = 0;
    let mouthSmoothed = 0;
    let peak = 0;
    let blink = 0;
    let blinkUntil = 0;
    let nextBlinkAt = performance.now() + 2800 + Math.random() * 2200;

    const draw = (now: number) => {
      const current = motionRef.current;
      let target = 0;
      let mouthTarget = 0;

      if (current === "hearing") {
        target = Math.min(1, levels().input * 8);
        // Soft attentive parting — never a full talk oval.
        mouthTarget = 0.12 + target * 0.16;
      } else if (current === "speaking") {
        target = Math.min(1, levels().output * 8);
        // Slow jaw cycle + energy: reads as talking without a frantic blink-oval.
        const jaw =
          0.42 +
          0.28 * Math.sin(now / 165) +
          0.18 * Math.sin(now / 97 + 1.1);
        mouthTarget = Math.min(0.92, 0.18 + target * 0.55 * Math.max(0.25, jaw));
      } else if (current === "processing" || current === "pending") {
        target = 0.28 + 0.08 * Math.sin(now / 520);
        mouthTarget = 0;
      } else if (current === "listening") {
        target = 0.1 + 0.04 * Math.sin(now / 900);
        mouthTarget = 0;
      } else if (current === "settle") {
        target = 0.06;
        mouthTarget = 0;
      }

      smoothed += (target - smoothed) * 0.22;
      mouthSmoothed += (mouthTarget - mouthSmoothed) * 0.28;
      const instantPeak = Math.max(0, target - smoothed);
      peak += (instantPeak - peak) * 0.35;
      const mouth = mouthSmoothed;

      const canBlink =
        current === "listening" ||
        current === "hearing" ||
        current === "speaking" ||
        current === "processing" ||
        current === "pending";

      if (canBlink) {
        if (blink > 0 && now >= blinkUntil) {
          blink = 0;
          nextBlinkAt = now + 2800 + Math.random() * 3200;
        } else if (blink === 0 && now >= nextBlinkAt) {
          blink = 1;
          blinkUntil = now + 110 + Math.random() * 50;
        }
      } else {
        blink = 0;
        nextBlinkAt = now + 3000;
      }

      el.style.setProperty("--chatai-companion-energy", smoothed.toFixed(3));
      el.style.setProperty("--chatai-companion-mouth", mouth.toFixed(3));
      el.style.setProperty("--chatai-companion-blink", blink.toFixed(3));
      el.style.setProperty("--chatai-companion-peak", Math.min(1, peak * 4).toFixed(3));
      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      clearCompanionVars(el);
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
      <span className="chatai-companion-mouth" />
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
