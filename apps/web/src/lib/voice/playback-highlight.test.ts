import { describe, expect, it } from "vitest";

import { playFromPositionMs, turnSeek } from "./audio-offset";
import {
  PLAY_FROM_SEEK_TOLERANCE_MS,
  highlightedTurnId,
  initialPlaybackHighlight,
  reducePlaybackHighlight,
  type PlaybackHighlightEvent,
  type PlaybackHighlightState,
} from "./playback-highlight";

const turns = [
  { id: "u1", offsetMs: 0 },
  { id: "a1", offsetMs: 4_000 },
  { id: "u2", offsetMs: 12_000 },
  { id: "a2", offsetMs: 15_000 },
  { id: "legacy", offsetMs: null },
];
const recording = { playable: true, durationMs: 60_000 };

function playFrom(turnId: string): PlaybackHighlightEvent {
  const offsetMs = turns.find((turn) => turn.id === turnId)?.offsetMs ?? null;
  const seek = turnSeek(offsetMs, recording);
  if (!seek.available) throw new Error(`expected a seek for ${turnId}`);
  return { type: "play_from", turnId, offsetMs: seek.ms, startMs: playFromPositionMs(seek) };
}

/** Highlighted turn after each event, as the owner would see it. */
function run(
  events: PlaybackHighlightEvent[],
  from: PlaybackHighlightState = initialPlaybackHighlight,
): { state: PlaybackHighlightState; highlights: Array<string | null> } {
  let state = from;
  const highlights: Array<string | null> = [];
  for (const event of events) {
    state = reducePlaybackHighlight(state, event);
    highlights.push(highlightedTurnId(state, turns));
  }
  return { state, highlights };
}

describe("playback highlight", () => {
  it("highlights nothing until the owner starts playback", () => {
    expect(highlightedTurnId(initialPlaybackHighlight, turns)).toBeNull();
  });

  it("play from highlights the clicked turn immediately and holds it through the preroll", () => {
    const { highlights, state } = run([
      playFrom("u2"),
      { type: "seeked", positionMs: 11_500 },
      { type: "progress", positionMs: 11_500 },
      { type: "progress", positionMs: 11_750 },
      { type: "progress", positionMs: 11_999 },
    ]);
    expect(highlights).toEqual(["u2", "u2", "u2", "u2", "u2"]);
    expect(state.pinned).toEqual({ turnId: "u2", startMs: 11_500, offsetMs: 12_000 });
  });

  it("hands over to timeline highlighting at the real offset without flicker", () => {
    const { highlights, state } = run([
      playFrom("u2"),
      { type: "progress", positionMs: 11_900 },
      { type: "progress", positionMs: 12_000 },
      { type: "progress", positionMs: 12_250 },
    ]);
    expect(highlights).toEqual(["u2", "u2", "u2", "u2"]);
    expect(state.pinned).toBeNull();
  });

  it("the next turn activates at its real offset, not shifted by the preroll", () => {
    const { highlights } = run([
      playFrom("u2"),
      { type: "progress", positionMs: 12_000 },
      { type: "progress", positionMs: 14_500 },
      { type: "progress", positionMs: 14_999 },
      { type: "progress", positionMs: 15_000 },
    ]);
    expect(highlights).toEqual(["u2", "u2", "u2", "u2", "a2"]);
  });

  it("a manual seek elsewhere clears the play-from highlight", () => {
    const forward = run([playFrom("u2"), { type: "seeked", positionMs: 5_000 }]);
    expect(forward.highlights).toEqual(["u2", "a1"]);
    expect(forward.state.pinned).toBeNull();

    // Inside the preroll window but not where "play from" landed: normal timeline again.
    const nearby = run([playFrom("u2"), { type: "seeked", positionMs: 11_900 }]);
    expect(nearby.highlights).toEqual(["u2", "a1"]);
  });

  it("the play-from seek itself does not count as a manual seek", () => {
    const { highlights } = run([
      playFrom("u2"),
      { type: "seeked", positionMs: 11_500 + PLAY_FROM_SEEK_TOLERANCE_MS },
    ]);
    expect(highlights).toEqual(["u2", "u2"]);
  });

  it("clicking a different turn replaces the previous selection", () => {
    const { highlights, state } = run([
      playFrom("u2"),
      { type: "progress", positionMs: 11_700 },
      playFrom("a1"),
      { type: "seeked", positionMs: 3_500 },
      { type: "progress", positionMs: 3_800 },
    ]);
    expect(highlights).toEqual(["u2", "u2", "a1", "a1", "a1"]);
    expect(state.pinned).toEqual({ turnId: "a1", startMs: 3_500, offsetMs: 4_000 });

    const later = run([{ type: "progress", positionMs: 4_000 }], state);
    expect(later.highlights).toEqual(["a1"]);
  });

  it("a turn near the start: the preroll clamps to zero and the turn stays highlighted", () => {
    const nearStart = [
      { id: "first", offsetMs: 300 },
      { id: "second", offsetMs: 2_000 },
    ];
    const seek = turnSeek(300, recording);
    if (!seek.available) throw new Error("expected a seek");
    expect(playFromPositionMs(seek)).toBe(0);

    let state = reducePlaybackHighlight(initialPlaybackHighlight, {
      type: "play_from",
      turnId: "first",
      offsetMs: seek.ms,
      startMs: playFromPositionMs(seek),
    });
    const seen: Array<string | null> = [highlightedTurnId(state, nearStart)];
    for (const event of [
      { type: "seeked", positionMs: 0 },
      { type: "progress", positionMs: 0 },
      { type: "progress", positionMs: 250 },
      { type: "progress", positionMs: 300 },
      { type: "progress", positionMs: 2_000 },
    ] satisfies PlaybackHighlightEvent[]) {
      state = reducePlaybackHighlight(state, event);
      seen.push(highlightedTurnId(state, nearStart));
    }
    expect(seen).toEqual(["first", "first", "first", "first", "first", "second"]);
  });

  it("a turn at exactly 0 ms needs no pin; the timeline already highlights it", () => {
    const { highlights, state } = run([playFrom("u1"), { type: "seeked", positionMs: 0 }]);
    expect(highlights).toEqual(["u1", "u1"]);
    expect(state.pinned).toBeNull();
  });

  it("pause and end of audio clear the selection so it cannot go stale", () => {
    const paused = run([playFrom("u2"), { type: "pause", positionMs: 11_700 }]);
    expect(paused.highlights).toEqual(["u2", "a1"]);
    expect(paused.state.pinned).toBeNull();

    const resumed = run([{ type: "progress", positionMs: 11_800 }], paused.state);
    expect(resumed.highlights).toEqual(["a1"]);
  });

  it("suspend (another recording took over) hides the highlight but keeps the position", () => {
    const { highlights, state } = run([
      playFrom("u2"),
      { type: "suspend" },
      // The media element's own trailing timeupdate/pause must not revive it.
      { type: "progress", positionMs: 11_600 },
      { type: "pause", positionMs: 11_600 },
    ]);
    expect(highlights).toEqual(["u2", null, null, null]);
    expect(state).toEqual({ positionMs: 11_600, started: false, pinned: null });

    const resumed = run([{ type: "play", positionMs: 11_600 }], state);
    expect(resumed.highlights).toEqual(["a1"]);
  });

  it("only a play (or play from) starts highlighting", () => {
    const { highlights } = run([
      { type: "seeked", positionMs: 5_000 },
      { type: "progress", positionMs: 5_000 },
      { type: "play", positionMs: 5_000 },
    ]);
    expect(highlights).toEqual([null, null, "a1"]);
  });

  describe("timeline V2 (120 ms preroll)", () => {
    function playFromV2(turnId: string): PlaybackHighlightEvent {
      const offsetMs = turns.find((turn) => turn.id === turnId)?.offsetMs ?? null;
      const seek = turnSeek(offsetMs, recording);
      if (!seek.available) throw new Error(`expected a seek for ${turnId}`);
      return { type: "play_from", turnId, offsetMs: seek.ms, startMs: playFromPositionMs(seek, 2) };
    }

    it("pins the clicked turn through the shorter preroll and hands over at the real offset", () => {
      const { highlights, state } = run([
        playFromV2("u2"),
        { type: "seeked", positionMs: 11_880 },
        { type: "progress", positionMs: 11_880 },
        { type: "progress", positionMs: 11_999 },
        { type: "progress", positionMs: 12_000 },
        { type: "progress", positionMs: 14_999 },
        { type: "progress", positionMs: 15_000 },
      ]);
      expect(highlights).toEqual(["u2", "u2", "u2", "u2", "u2", "u2", "a2"]);
      expect(state.pinned).toBeNull();
    });

    it("the play-from seek is recognized; a manual seek clears the pin", () => {
      const own = run([playFromV2("u2"), { type: "seeked", positionMs: 11_900 }]);
      expect(own.highlights).toEqual(["u2", "u2"]);
      expect(own.state.pinned).toEqual({ turnId: "u2", startMs: 11_880, offsetMs: 12_000 });

      const manual = run([playFromV2("u2"), { type: "seeked", positionMs: 5_000 }]);
      expect(manual.highlights).toEqual(["u2", "a1"]);
      expect(manual.state.pinned).toBeNull();
    });

    it("pause and suspend clear the V2 selection the same way", () => {
      expect(run([playFromV2("a1"), { type: "pause", positionMs: 3_900 }]).highlights).toEqual(["a1", "u1"]);
      expect(run([playFromV2("a1"), { type: "suspend" }]).highlights).toEqual(["a1", null]);
    });
  });

  it("reset (recording changed or became unplayable) clears everything", () => {
    const { highlights, state } = run([playFrom("u2"), { type: "reset" }]);
    expect(highlights).toEqual(["u2", null]);
    expect(state).toEqual(initialPlaybackHighlight);
  });
});
