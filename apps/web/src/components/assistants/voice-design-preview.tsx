"use client";

import { useEffect, useState } from "react";

type SimPhase =
  | "idle"
  | "listening"
  | "hearing"
  | "processing"
  | "speaking"
  | "reconnecting"
  | "error";

const PHASES: Array<{ id: SimPhase; label: string; status: string }> = [
  { id: "idle", label: "Idle", status: "Ready when you are" },
  { id: "listening", label: "Listening", status: "I’m listening" },
  { id: "hearing", label: "Hearing you", status: "Hearing you" },
  { id: "processing", label: "Processing", status: "Looking that up…" },
  { id: "speaking", label: "Speaking", status: "Speaking" },
  { id: "reconnecting", label: "Reconnecting", status: "Reconnecting…" },
  { id: "error", label: "Error", status: "Voice stopped" },
];

export function VoiceDesignPreview({
  assistantName,
  accentColor,
  captionsDefault,
  layout = "orb",
  guided = false,
  companion = false,
  sidePanel = false,
  suggestedQuestions = [],
  welcomeMessage,
}: {
  assistantName: string;
  accentColor: string;
  captionsDefault: boolean;
  layout?: "orb" | "compact";
  guided?: boolean;
  companion?: boolean;
  sidePanel?: boolean;
  suggestedQuestions?: string[];
  welcomeMessage?: string;
}) {
  const [phase, setPhase] = useState<SimPhase>(guided || companion ? "idle" : "listening");
  const [captionsOpen, setCaptionsOpen] = useState(captionsDefault);
  const [muted, setMuted] = useState(false);
  const [companionBlink, setCompanionBlink] = useState(false);

  useEffect(() => {
    setCaptionsOpen(captionsDefault);
  }, [captionsDefault]);

  useEffect(() => {
    if (!companion) return;
    setCompanionBlink(true);
    const close = window.setTimeout(() => setCompanionBlink(false), 120);
    return () => window.clearTimeout(close);
  }, [companion, phase]);

  useEffect(() => {
    if (!companion || phase !== "listening") return;
    const id = window.setInterval(() => {
      setCompanionBlink(true);
      window.setTimeout(() => setCompanionBlink(false), 120);
    }, 3600);
    return () => window.clearInterval(id);
  }, [companion, phase]);

  const current = PHASES.find((entry) => entry.id === phase) ?? PHASES[1]!;
  const status = muted && phase !== "idle" && phase !== "error" ? "Microphone muted" : current.status;
  const questions = suggestedQuestions.filter(Boolean).slice(0, 3);
  const companionSpeech =
    welcomeMessage?.trim() || `Hi — I’m ${assistantName}. Ready when you are.`;
  const activePose =
    phase === "speaking"
      ? "40% 60% 48% 38%"
      : phase === "hearing"
        ? "42% 58% 45% 35%"
        : phase === "listening"
          ? "48% 52% 42% 40%"
          : "52% 48% 38% 42%";
  const companionMouth =
    phase === "speaking" ? 0.85 : phase === "hearing" ? 0.22 : phase === "processing" ? 0.06 : 0;
  const companionEnergy =
    phase === "speaking" || phase === "hearing" ? 0.7 : phase === "processing" ? 0.28 : 0.1;
  const kicker = guided
    ? "Live voice guide"
    : companion
      ? "Live companion"
      : sidePanel
        ? "Side panel"
        : "Live voice";
  const shellClass = sidePanel
    ? "min-h-[min(28rem,62dvh)] max-w-[22rem] ml-auto sm:min-h-[34rem]"
    : layout === "compact"
      ? "min-h-[min(20rem,55dvh)] max-w-sm sm:min-h-[22rem]"
      : "min-h-[min(24rem,58dvh)] sm:min-h-[28rem]";

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-100">
        Design preview — simulated phases only. No microphone or live session.
        {sidePanel
          ? " Tall edge layout beside the page — no automatic page content."
          : null}
      </p>
      <div
        className={`flex flex-col items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-4 text-center sm:gap-3 sm:px-4 sm:py-5 ${shellClass}`}
        style={{ ["--sim-accent" as string]: accentColor }}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {kicker}
          </span>
          <span className="text-[17px] font-semibold tracking-tight">{assistantName}</span>
        </div>
        {guided && phase === "idle" && questions.length > 0 ? (
          <div className="w-full space-y-2 text-left">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Suggested questions
            </p>
            {questions.map((question) => (
              <div
                key={question}
                className="rounded-xl border border-border px-3 py-2 text-sm"
              >
                {question}
              </div>
            ))}
          </div>
        ) : null}
        {companion && phase === "idle" ? (
          <p className="max-w-[28ch] rounded-2xl border border-border bg-background px-3.5 py-3 text-sm leading-snug">
            {companionSpeech}
          </p>
        ) : null}
        {companion ? (
          <div
            aria-hidden
            data-motion={phase}
            className="relative h-[148px] w-[132px] shrink-0"
          >
            <div
              className="absolute inset-x-[8%] bottom-[18%] top-0"
              style={{
                borderRadius: activePose,
                background: `radial-gradient(ellipse at 27% 25%, color-mix(in srgb, ${accentColor}, #fff 62%) 0%, ${accentColor} 52%, color-mix(in srgb, ${accentColor}, #1a1a12 45%) 88%)`,
                boxShadow:
                  "inset -10px -12px 18px rgb(20 36 30 / 28%), inset 4px 6px 14px rgb(255 255 255 / 35%), 0 14px 16px rgb(20 36 30 / 14%)",
                transform: `rotate(${-6 + companionEnergy * 14}deg) translateY(${companionEnergy * -8}px) scale(${0.96 + companionEnergy * 0.1})`,
                transition: "transform 180ms ease, border-radius 480ms ease",
              }}
            />
            <span
              className="absolute left-[34%] top-[38%] h-2.5 w-2.5 rounded-full bg-[#1a1a12]"
              style={{
                transform: `scaleY(${companionBlink ? 0.08 : 1})`,
                transformOrigin: "center 55%",
                transition: "transform 90ms ease",
              }}
            />
            <span
              className="absolute right-[34%] top-[38%] h-2.5 w-2.5 rounded-full bg-[#1a1a12]"
              style={{
                transform: `scaleY(${companionBlink ? 0.08 : 1})`,
                transformOrigin: "center 55%",
                transition: "transform 90ms ease",
              }}
            />
            {companionMouth > 0.05 ? (
              <span
                className="absolute left-1/2 top-[51%] rounded-full bg-[#1a1a12]"
                style={{
                  width: phase === "hearing" ? 14 : 16,
                  height: 4 + companionMouth * (phase === "hearing" ? 6 : 10),
                  marginLeft: phase === "hearing" ? -7 : -8,
                  opacity: phase === "hearing" ? 0.75 : 0.92,
                  transform: `scaleY(${0.55 + companionMouth * 0.7})`,
                  transformOrigin: "center top",
                  transition: "height 160ms ease, transform 160ms ease",
                }}
              />
            ) : (
              <span className="absolute left-1/2 top-[52%] ml-[-11px] h-2.5 w-[22px] rounded-b-[14px] border-2 border-t-0 border-[#1a1a12] opacity-85" />
            )}
            <span
              className="absolute bottom-[4%] left-[28%] h-3.5 w-[22px] rounded-[40%_40%_50%_50%]"
              style={{
                background: `color-mix(in srgb, ${accentColor}, #1a1a12 35%)`,
                transform: `translateY(${companionEnergy * -5}px)`,
                transition: "transform 180ms ease",
              }}
            />
            <span
              className="absolute bottom-[4%] right-[28%] h-3.5 w-[22px] rounded-[40%_40%_50%_50%]"
              style={{
                background: `color-mix(in srgb, ${accentColor}, #1a1a12 35%)`,
                transform: `translateY(${companionEnergy * -5}px)`,
                transition: "transform 180ms ease",
              }}
            />
          </div>
        ) : (
          <div
            aria-hidden
            data-motion={phase}
            className={`sim-orb relative shrink-0 ${layout === "compact" ? "h-[108px] w-[108px]" : "h-[132px] w-[132px]"}`}
            style={{
              borderRadius:
                phase === "speaking"
                  ? "40% 60% 52% 48% / 58% 45% 55% 42%"
                  : phase === "hearing"
                    ? "52% 48% 60% 40% / 48% 55% 45% 52%"
                    : phase === "listening"
                      ? "55% 45% 42% 58% / 43% 60% 40% 57%"
                      : "48% 52% 57% 43% / 53% 42% 58% 47%",
              background: `radial-gradient(ellipse at 28% 20%, #fff8e8 0%, color-mix(in srgb, ${accentColor}, #fff 55%) 26%, ${accentColor} 54%, color-mix(in srgb, ${accentColor}, #1a1a12 55%) 82%)`,
              boxShadow:
                "inset -12px -18px 22px rgb(20 36 30 / 42%), inset 4px 6px 16px rgb(255 255 255 / 42%), 0 16px 22px rgb(20 36 30 / 14%)",
              transform: phase === "hearing" || phase === "speaking" ? "scale(1.06)" : "scale(1)",
              transition: "transform 180ms ease, border-radius 500ms ease",
            }}
          />
        )}
        <p className="text-[15px] font-semibold" role="status">
          {status}
        </p>
        {captionsOpen && !(companion && phase === "idle") ? (
          <div className="w-full rounded-xl bg-muted/60 px-3 py-2 text-left text-sm">
            <p className="text-[11px] font-semibold text-muted-foreground">You</p>
            <p>How does voice look on our site?</p>
            <p className="mt-2 text-[11px] font-semibold text-muted-foreground">Assistant</p>
            <p>
              Here’s a sample caption for the{" "}
              {companion
                ? "Companion"
                : guided
                  ? "Guided"
                  : sidePanel
                    ? "Side panel"
                    : "Orb"}{" "}
              stage.
            </p>
          </div>
        ) : null}
        <div className="mt-auto grid w-full grid-cols-2 gap-2 pt-2 sm:flex sm:flex-wrap sm:justify-center">
          <button
            type="button"
            className="col-span-2 min-h-11 rounded-lg bg-[var(--sim-accent)] px-3.5 py-2 text-sm font-semibold text-white sm:col-span-1 sm:min-h-0"
            disabled
          >
            {phase === "idle" ? "Start" : "End"}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-semibold sm:min-h-0"
            aria-pressed={muted}
            onClick={() => setMuted((value) => !value)}
          >
            {muted ? "Unmute" : "Mute"}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-lg border border-border bg-background px-3.5 py-2 text-sm font-semibold sm:min-h-0"
            aria-pressed={captionsOpen}
            onClick={() => setCaptionsOpen((value) => !value)}
          >
            Captions
          </button>
        </div>
      </div>
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Simulate phase</legend>
        <div className="flex flex-wrap gap-1.5">
          {PHASES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setPhase(entry.id)}
              className={`min-h-8 rounded-md border px-2.5 py-1.5 text-xs ${
                phase === entry.id ? "border-foreground bg-foreground text-background" : "border-border"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
