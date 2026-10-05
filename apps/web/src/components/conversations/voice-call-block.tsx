"use client";

import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { Phone, Play } from "lucide-react";

import { MessageBubble, formatTimestamp } from "@/components/conversations/message-bubble";
import { usePlaybackScope } from "@/components/conversations/recording-playback-scope";
import {
  VoiceRecordingCard,
  type RecordingController,
  type RecordingPlaybackEvent,
} from "@/components/conversations/voice-recording-card";
import { VoiceTurnDetailsPanel } from "@/components/conversations/voice-turn-details";
import type { TimelineEntry, TimelineMessage } from "@/lib/conversation-timeline";
import {
  highlightedTurnId,
  initialPlaybackHighlight,
  reducePlaybackHighlight,
} from "@/lib/voice/playback-highlight";
import {
  playFromPositionMs,
  turnSeek,
  type SeekableRecording,
  type TurnSeek,
  type TurnSeekUnavailableReason,
} from "@/lib/voice/audio-offset";
import { formatVoiceDuration } from "@/lib/voice/duration-format";
import { formatClock, recordingCardState } from "@/lib/voice/recording/card-state";
import { cn } from "@/lib/utils";

export type VoiceCallEntry = Extract<TimelineEntry, { kind: "call" }>;

const UNAVAILABLE_HINT: Record<TurnSeekUnavailableReason, string | null> = {
  no_offset: null,
  no_recording: null,
  recording_unavailable: "Recording unavailable",
  outside_recording: "Not in the saved recording",
};

function SeekControl({
  offsetMs,
  seek,
  onPlayFrom,
}: {
  offsetMs: number | null;
  seek: TurnSeek;
  onPlayFrom: (seek: Extract<TurnSeek, { available: true }>) => void;
}) {
  if (seek.available) {
    return (
      <button
        type="button"
        onClick={() => onPlayFrom(seek)}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Play recording from ${formatClock(seek.ms)}`}
      >
        <Play className="size-3" aria-hidden />
        {formatClock(seek.ms)}
      </button>
    );
  }
  if (offsetMs === null) return null;
  const hint = UNAVAILABLE_HINT[seek.reason];
  return (
    <span className="px-1.5 font-mono text-xs tabular-nums text-muted-foreground/70" title={hint ?? undefined}>
      {formatClock(offsetMs)}
      {hint ? <span className="ml-1 font-sans">· {hint}</span> : null}
    </span>
  );
}

export function VoiceCallBlock({ assistantId, entry }: { assistantId: string; entry: VoiceCallEntry }) {
  const { call, recording, turns } = entry;
  const controllerRef = useRef<RecordingController | null>(null);
  const [seekable, setSeekable] = useState<SeekableRecording | null>(() =>
    recording
      ? { playable: recordingCardState(recording).playable, durationMs: recording.durationMs }
      : null,
  );
  const [highlight, dispatch] = useReducer(reducePlaybackHighlight, initialPlaybackHighlight);
  const recordingId = recording?.id ?? null;
  const [highlightRecordingId, setHighlightRecordingId] = useState(recordingId);
  if (highlightRecordingId !== recordingId) {
    setHighlightRecordingId(recordingId);
    dispatch({ type: "reset" });
  }

  const seeks = useMemo(
    () => new Map(turns.map((turn) => [turn.id, turnSeek(turn.audioOffsetMs, seekable)])),
    [turns, seekable],
  );
  const activeId = highlightedTurnId(
    highlight,
    turns.map((turn) => {
      const seek = seeks.get(turn.id);
      return { id: turn.id, offsetMs: seek?.available ? seek.ms : null };
    }),
  );

  const scope = usePlaybackScope();
  const playerId = useId();
  useEffect(() => {
    if (!scope) return;
    return scope.register(playerId, () => {
      controllerRef.current?.pause();
      dispatch({ type: "suspend" });
    });
  }, [scope, playerId]);

  const timelineVersion = recording?.timelineVersion ?? 1;
  const onPlayFrom = useCallback(
    (turnId: string, seek: Extract<TurnSeek, { available: true }>) => {
      scope?.claim(playerId);
      const startMs = playFromPositionMs(seek, timelineVersion);
      dispatch({ type: "play_from", turnId, offsetMs: seek.ms, startMs });
      controllerRef.current?.seek(startMs);
    },
    [scope, playerId, timelineVersion],
  );
  const onPlayback = useCallback(
    (event: RecordingPlaybackEvent) => {
      if (event.type === "play") scope?.claim(playerId);
      dispatch(event);
    },
    [scope, playerId],
  );
  const onSeekableChange = useCallback((next: SeekableRecording) => {
    setSeekable(next);
    if (!next.playable) dispatch({ type: "reset" });
  }, []);

  return (
    <section
      aria-label="Voice call"
      className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4"
    >
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Phone className="size-4 text-muted-foreground" aria-hidden />
            Voice call · {call.sourceLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatTimestamp(call.startedAt)}
            {call.durationMs !== null ? ` · ${formatVoiceDuration(call.durationMs / 1000)}` : null}
          </p>
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span
            className={cn(
              call.endTone === "error" && "text-destructive",
              call.endTone === "warning" && "text-amber-600 dark:text-amber-400",
              call.endTone === "default" && "text-muted-foreground",
            )}
          >
            {call.endLabel}
          </span>
          {call.usageLabel ? <span className="text-muted-foreground">{call.usageLabel}</span> : null}
          {call.interruptCount > 0 ? (
            <span className="text-muted-foreground">
              {call.interruptCount} {call.interruptCount === 1 ? "interruption" : "interruptions"}
            </span>
          ) : null}
        </p>
      </header>

      {recording ? (
        <VoiceRecordingCard
          key={recording.id}
          assistantId={assistantId}
          initial={recording}
          controllerRef={controllerRef}
          onPlayback={onPlayback}
          onSeekableChange={onSeekableChange}
        />
      ) : (
        <p className="text-xs text-muted-foreground">No recording for this call.</p>
      )}

      {turns.length === 0 ? (
        <p className="text-xs text-muted-foreground">No saved turns for this call.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {turns.map((turn: TimelineMessage) => (
            <MessageBubble
              key={turn.id}
              message={turn}
              showVoiceLabel={false}
              highlighted={turn.id === activeId}
              aside={
                <SeekControl
                  offsetMs={turn.audioOffsetMs}
                  seek={seeks.get(turn.id) ?? { available: false, reason: "no_offset" }}
                  onPlayFrom={(seek) => onPlayFrom(turn.id, seek)}
                />
              }
            >
              {turn.voiceDetails ? (
                <VoiceTurnDetailsPanel details={turn.voiceDetails} sourceCount={turn.sources.length} />
              ) : null}
            </MessageBubble>
          ))}
        </div>
      )}
    </section>
  );
}
