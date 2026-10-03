"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from "react";
import { Loader2, Mic, Pause, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SeekableRecording } from "@/lib/voice/audio-offset";
import { formatClock, recordingCardState } from "@/lib/voice/recording/card-state";
import type { VoiceRecordingView } from "@/lib/voice/recording/playback";
import { cn } from "@/lib/utils";

const POLL_MS = 5_000;

type PlaybackResponse = {
  recording: VoiceRecordingView;
  playback: { url: string; expiresAt: string } | null;
};

export type RecordingController = {
  /** Play from `ms` into the recording (fetches a fresh playback URL when needed). */
  seek: (ms: number) => void;
  /** Pause where it is; the next Play resumes from the same position. */
  pause: () => void;
};

/** Playback position updates; `pause` also covers the end of the audio. */
export type RecordingPlaybackEvent = {
  type: "play" | "progress" | "seeked" | "pause";
  positionMs: number;
};

/**
 * Stored stereo keeps the visitor left and the assistant right; for listening,
 * fold both into the center (0.8·(L+R) on both ears). Falls back to plain
 * element playback where Web Audio is unavailable.
 */
function centerStereo(audio: HTMLAudioElement): AudioContext | null {
  const Ctx =
    typeof window !== "undefined"
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(audio);
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = "explicit";
    mono.channelInterpretation = "speakers";
    mono.gain.value = 1.6;
    source.connect(mono).connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

export function VoiceRecordingCard({
  assistantId,
  initial,
  controllerRef,
  onPlayback,
  onSeekableChange,
}: {
  assistantId: string;
  initial: VoiceRecordingView;
  controllerRef?: RefObject<RecordingController | null>;
  onPlayback?: (event: RecordingPlaybackEvent) => void;
  onSeekableChange?: (recording: SeekableRecording) => void;
}) {
  const [recording, setRecording] = useState(initial);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | null>(initial.durationMs);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const retriedRef = useRef(false);
  const onPlaybackRef = useRef(onPlayback);
  const onSeekableRef = useRef(onSeekableChange);

  const endpoint = `/api/assistants/${encodeURIComponent(assistantId)}/voice-recordings/${encodeURIComponent(recording.id)}`;
  const state = recordingCardState(recording, { unavailable });

  useEffect(() => {
    onPlaybackRef.current = onPlayback;
    onSeekableRef.current = onSeekableChange;
  });

  useEffect(() => {
    onSeekableRef.current?.({ playable: state.playable, durationMs });
  }, [state.playable, durationMs]);

  const fetchPlayback = useCallback(async (): Promise<PlaybackResponse | null> => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as PlaybackResponse;
    setRecording(body.recording);
    return body;
  }, [endpoint]);

  useEffect(() => {
    if (!state.poll) return;
    const timer = setInterval(() => void fetchPlayback().catch(() => undefined), POLL_MS);
    return () => clearInterval(timer);
  }, [state.poll, fetchPlayback]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      void ctxRef.current?.close().catch(() => undefined);
    },
    [],
  );

  const loadAndPlay = useCallback(
    async (resumeAtSec = 0) => {
      const audio = audioRef.current;
      if (!audio) return;
      setLoading(true);
      try {
        const body = await fetchPlayback();
        if (!body?.playback) {
          if (body?.recording.status === "ready" || !body) setUnavailable(true);
          return;
        }
        if (!ctxRef.current) ctxRef.current = centerStereo(audio);
        await ctxRef.current?.resume().catch(() => undefined);
        audio.src = body.playback.url;
        if (resumeAtSec > 0) audio.currentTime = resumeAtSec;
        await audio.play();
      } catch {
        setUnavailable(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchPlayback],
  );

  const toggle = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.src) {
      try {
        await ctxRef.current?.resume().catch(() => undefined);
        await audio.play();
        return;
      } catch {
        // Token may have expired while paused; fall through to a fresh URL.
      }
    }
    await loadAndPlay(audio.currentTime);
  }, [loadAndPlay]);

  const seek = useCallback(
    (ms: number) => {
      const audio = audioRef.current;
      if (!audio || !state.playable) return;
      const seconds = Math.max(0, ms) / 1000;
      if (!audio.src) {
        void loadAndPlay(seconds);
        return;
      }
      audio.currentTime = seconds;
      setElapsedMs(seconds * 1000);
      void (async () => {
        try {
          await ctxRef.current?.resume().catch(() => undefined);
          await audio.play();
        } catch {
          await loadAndPlay(seconds);
        }
      })();
    },
    [loadAndPlay, state.playable],
  );

  const pause = useCallback(() => audioRef.current?.pause(), []);

  useImperativeHandle(controllerRef, () => ({ seek, pause }), [seek, pause]);

  const onError = useCallback(() => {
    const audio = audioRef.current;
    if (!audio?.src) return;
    if (retriedRef.current) {
      setUnavailable(true);
      setPlaying(false);
      return;
    }
    // One silent retry with a fresh short-lived URL (expired token while paused).
    retriedRef.current = true;
    void loadAndPlay(audio.currentTime);
  }, [loadAndPlay]);

  const report = (type: RecordingPlaybackEvent["type"], audio: HTMLAudioElement) =>
    onPlaybackRef.current?.({ type, positionMs: audio.currentTime * 1000 });

  return (
    <section
      aria-label="Voice recording"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Mic className="size-4" aria-hidden />
        </span>
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            Voice recording
            {recording.partial && recording.status === "ready" ? <Badge variant="warning">Partial</Badge> : null}
          </p>
          <p
            className={cn(
              "text-xs",
              state.tone === "error" && "text-destructive",
              state.tone === "warning" && "text-amber-600 dark:text-amber-400",
              (state.tone === "muted" || state.tone === "default") && "text-muted-foreground",
            )}
            role={state.tone === "error" ? "alert" : undefined}
          >
            {state.message}
          </p>
        </div>
      </div>

      {state.playable ? (
        <div className="flex items-center gap-3 sm:ml-auto">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void toggle()}
            disabled={loading}
            aria-label={playing ? "Pause Voice recording" : "Play Voice recording"}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : playing ? (
              <Pause className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {playing ? "Pause" : "Play"}
          </Button>
          <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
            {formatClock(elapsedMs)} / {formatClock(durationMs)}
          </span>
        </div>
      ) : null}

      <audio
        ref={audioRef}
        preload="none"
        className="hidden"
        onPlay={(e) => {
          setPlaying(true);
          report("play", e.currentTarget);
        }}
        onPause={(e) => {
          setPlaying(false);
          report("pause", e.currentTarget);
        }}
        onEnded={(e) => {
          setPlaying(false);
          report("pause", e.currentTarget);
        }}
        onSeeked={(e) => {
          setElapsedMs(e.currentTarget.currentTime * 1000);
          report("seeked", e.currentTarget);
        }}
        onTimeUpdate={(e) => {
          setElapsedMs(e.currentTarget.currentTime * 1000);
          report("progress", e.currentTarget);
        }}
        onLoadedMetadata={(e) => {
          const seconds = e.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) setDurationMs(seconds * 1000);
        }}
        onError={onError}
      />
    </section>
  );
}
