/** Which Voice turn is highlighted while the owner listens (pure; safe for client components). */

import { activeTurnId } from "./audio-offset";

/**
 * A "play from" seek lands this close to the requested position. Wider jumps while a
 * turn is pinned are the owner seeking elsewhere.
 */
export const PLAY_FROM_SEEK_TOLERANCE_MS = 250;

export type PlaybackHighlightState = {
  positionMs: number;
  /**
   * Nothing is highlighted until playback starts, or after another recording on
   * the page took over; the next play resumes highlighting from `positionMs`.
   */
  started: boolean;
  /**
   * The turn clicked with "play from", held through its preroll until playback
   * reaches the turn's real offset.
   */
  pinned: { turnId: string; startMs: number; offsetMs: number } | null;
};

export type PlaybackHighlightEvent =
  | { type: "play_from"; turnId: string; offsetMs: number; startMs: number }
  | { type: "play"; positionMs: number }
  | { type: "progress"; positionMs: number }
  | { type: "seeked"; positionMs: number }
  | { type: "pause"; positionMs: number }
  /** Another recording on the page started; this one was paused for it. */
  | { type: "suspend" }
  | { type: "reset" };

export const initialPlaybackHighlight: PlaybackHighlightState = {
  positionMs: 0,
  started: false,
  pinned: null,
};

function releasedAtOffset(
  pinned: PlaybackHighlightState["pinned"],
  positionMs: number,
): PlaybackHighlightState["pinned"] {
  return pinned && positionMs < pinned.offsetMs ? pinned : null;
}

export function reducePlaybackHighlight(
  state: PlaybackHighlightState,
  event: PlaybackHighlightEvent,
): PlaybackHighlightState {
  switch (event.type) {
    case "play_from":
      return {
        positionMs: event.startMs,
        started: true,
        pinned: event.startMs < event.offsetMs
          ? { turnId: event.turnId, startMs: event.startMs, offsetMs: event.offsetMs }
          : null,
      };
    case "play":
      return {
        positionMs: event.positionMs,
        started: true,
        pinned: releasedAtOffset(state.pinned, event.positionMs),
      };
    case "progress":
      return {
        positionMs: event.positionMs,
        started: state.started,
        pinned: releasedAtOffset(state.pinned, event.positionMs),
      };
    case "seeked": {
      const own =
        state.pinned !== null &&
        Math.abs(event.positionMs - state.pinned.startMs) <= PLAY_FROM_SEEK_TOLERANCE_MS;
      return {
        positionMs: event.positionMs,
        started: state.started,
        pinned: own ? releasedAtOffset(state.pinned, event.positionMs) : null,
      };
    }
    case "pause":
      return { positionMs: event.positionMs, started: state.started, pinned: null };
    case "suspend":
      return { positionMs: state.positionMs, started: false, pinned: null };
    case "reset":
      return initialPlaybackHighlight;
  }
}

/** The pinned "play from" turn during its preroll, otherwise the turn at the playhead. */
export function highlightedTurnId(
  state: PlaybackHighlightState,
  turns: Array<{ id: string; offsetMs: number | null }>,
): string | null {
  if (!state.started) return null;
  if (state.pinned) return state.pinned.turnId;
  return activeTurnId(turns, state.positionMs);
}
