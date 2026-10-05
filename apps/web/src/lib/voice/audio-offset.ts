/** Pure Voice turn timing helpers (safe for client components). */

/**
 * Upper bound for a turn offset. Voice runtimes are closed after one hour
 * (`VOICE_RUNTIME_MAX_MS`); anything far beyond that is not a real position.
 */
export const MAX_AUDIO_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Rounding jitter just below zero is treated as the start of the call. */
const NEGATIVE_JITTER_MS = 250;

/**
 * Validates a provider/session-relative turn offset. Returns whole milliseconds, or
 * null when the value is missing or malformed (never guessed).
 */
export function sanitizeAudioOffsetMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = Math.round(value);
  if (ms < 0) return ms >= -NEGATIVE_JITTER_MS ? 0 : null;
  if (ms > MAX_AUDIO_OFFSET_MS) return null;
  return ms;
}

export type TurnSeekUnavailableReason =
  "no_offset" | "no_recording" | "recording_unavailable" | "outside_recording";

export type TurnSeek =
  { available: true; ms: number } | { available: false; reason: TurnSeekUnavailableReason };

export type SeekableRecording = {
  /** Audio can be played right now (ready and not found missing). */
  playable: boolean;
  /** Length of the stored audio when known (DB value or loaded metadata). */
  durationMs: number | null;
};

/**
 * Whether a turn can be played from its offset. Partial recordings stay seekable
 * inside the audio they hold; only offsets past the stored end are unavailable.
 */
export function turnSeek(offsetMs: number | null, recording: SeekableRecording | null): TurnSeek {
  const ms = sanitizeAudioOffsetMs(offsetMs);
  if (ms === null) return { available: false, reason: "no_offset" };
  if (!recording) return { available: false, reason: "no_recording" };
  if (!recording.playable) return { available: false, reason: "recording_unavailable" };
  const duration = recording.durationMs;
  if (duration !== null && Number.isFinite(duration) && duration >= 0 && ms >= duration) {
    return { available: false, reason: "outside_recording" };
  }
  return { available: true, ms };
}

/**
 * Lead-in before a turn when the owner clicks "play from" on a timeline V1
 * recording. V1 offsets are transcript stamps, which trail visitor speech, so
 * starting exactly at the offset clips the first words.
 */
export const PLAY_FROM_PREROLL_MS = 500;

/**
 * Timeline V2 lead-in (provisional, pending human playback acceptance). V2 offsets
 * are detected speech onsets; this covers the measured onset lead (≤ 40 ms), the
 * detector window, Opus frame/seek granularity and soft sub-threshold starts.
 */
export const PLAY_FROM_PREROLL_V2_MS = 120;

/** Lead-in for a recording's timeline version; unknown versions keep the V1 lead-in. */
export function playFromPrerollMs(timelineVersion: number | null | undefined): number {
  return timelineVersion === 2 ? PLAY_FROM_PREROLL_V2_MS : PLAY_FROM_PREROLL_MS;
}

/**
 * Playback position for an explicit "play from" on an available seek. Playback-only:
 * the stored offset, range checks and highlight boundaries all use the real offset.
 */
export function playFromPositionMs(
  seek: Extract<TurnSeek, { available: true }>,
  timelineVersion: number | null | undefined = 1,
): number {
  return Math.max(0, seek.ms - playFromPrerollMs(timelineVersion));
}

/**
 * The turn being heard at `positionMs`: the last turn whose offset is at or before
 * the playhead. Turns without offsets never highlight.
 */
export function activeTurnId(
  turns: Array<{ id: string; offsetMs: number | null }>,
  positionMs: number,
): string | null {
  if (!Number.isFinite(positionMs) || positionMs < 0) return null;
  let active: { id: string; ms: number } | null = null;
  for (const turn of turns) {
    const ms = sanitizeAudioOffsetMs(turn.offsetMs);
    if (ms === null || ms > positionMs) continue;
    if (!active || ms >= active.ms) active = { id: turn.id, ms };
  }
  return active?.id ?? null;
}
