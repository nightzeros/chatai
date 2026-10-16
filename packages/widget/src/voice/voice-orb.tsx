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
 * Layered CSS sphere. Energy from `levels()` drives a small scale range (0.96–1.08)
 * when motion is hearing/speaking; reduced-motion stays static.
 */
export function VoiceOrb({
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
      el.style.removeProperty("--chatai-orb-energy");
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
      // Map 0→1 into ~0.96–1.08 scale via CSS var.
      el.style.setProperty("--chatai-orb-energy", energy.toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      el.style.removeProperty("--chatai-orb-energy");
    };
  }, [levels, reducedMotion]);

  return (
    <div
      ref={ref}
      className="chatai-orb"
      data-motion={motion}
      aria-hidden="true"
    >
      <span className="chatai-orb-core" />
      <span className="chatai-orb-shine" />
      <span className="chatai-orb-shadow" />
    </div>
  );
}
