"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Types a phrase once on mount; shows full text immediately when reduced-motion. */
export function TypewriterText({
  text,
  className,
  startDelayMs = 280,
  charMs = 42,
}: {
  text: string;
  className?: string;
  startDelayMs?: number;
  charMs?: number;
}) {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(text);
      setDone(true);
      return;
    }

    let i = 0;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(() => {
      intervalId = setInterval(() => {
        i += 1;
        setShown(text.slice(0, i));
        if (i >= text.length) {
          clearInterval(intervalId);
          setDone(true);
        }
      }, charMs);
    }, startDelayMs);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [text, startDelayMs, charMs]);

  return (
    <span className={cn("inline", className)}>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{text}</span>
      <span
        aria-hidden
        className={cn(
          "ml-0.5 inline-block h-[0.9em] w-[0.08em] translate-y-[0.08em] bg-foreground align-baseline",
          done ? "opacity-0" : "animate-pulse",
        )}
      />
    </span>
  );
}

/**
 * Scales children with scroll: zoomed out away from the viewport sweet spot,
 * easing into a soft zoom-in as the block centers, then easing out again.
 */
export function ScrollZoom({
  children,
  className,
  minScale = 0.92,
  maxScale = 1.06,
}: {
  children: ReactNode;
  className?: string;
  minScale?: number;
  maxScale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(minScale);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setScale(1);
      setReady(true);
      return;
    }

    const node = ref.current;
    if (!node) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const sweetSpot = vh * 0.42;
      const focus = rect.top + rect.height * 0.35;
      const distance = Math.abs(focus - sweetSpot) / vh;
      // 1 at center, falls off as the block moves away (enter or exit)
      const t = Math.max(0, 1 - distance * 1.55);
      const eased = t * t * (3 - 2 * t);
      setScale(minScale + (maxScale - minScale) * eased);
      setReady(true);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [minScale, maxScale]);

  return (
    <div
      ref={ref}
      className={cn("will-change-transform", className)}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        transition: ready ? undefined : "none",
      }}
    >
      {children}
    </div>
  );
}
