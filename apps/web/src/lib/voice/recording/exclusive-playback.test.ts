import { describe, expect, it } from "vitest";

import { playFromPositionMs, turnSeek } from "../audio-offset";
import {
  highlightedTurnId,
  initialPlaybackHighlight,
  reducePlaybackHighlight,
  type PlaybackHighlightEvent,
  type PlaybackHighlightState,
} from "../playback-highlight";
import { createPlaybackScope, type PlaybackScope } from "./exclusive-playback";

type Turn = { id: string; offsetMs: number | null };

/**
 * One Voice call block on the review page: a media element (pause keeps
 * `currentTime`, like HTMLMediaElement) plus the same scope and highlight wiring
 * as `VoiceCallBlock`.
 */
function mountPlayer(scope: PlaybackScope | null, playerId: string, turns: Turn[], timelineVersion = 1) {
  const audio = { currentTime: 0, paused: true };
  let highlight: PlaybackHighlightState = initialPlaybackHighlight;
  const dispatch = (event: PlaybackHighlightEvent) => {
    highlight = reducePlaybackHighlight(highlight, event);
  };
  const report = (type: "play" | "progress" | "seeked" | "pause") => {
    if (type === "play") scope?.claim(playerId);
    dispatch({ type, positionMs: audio.currentTime });
  };
  const media = {
    play() {
      if (!audio.paused) return;
      audio.paused = false;
      report("play");
    },
    pause() {
      if (audio.paused) return;
      audio.paused = true;
      report("progress");
      report("pause");
    },
    seek(ms: number) {
      audio.currentTime = ms;
      report("seeked");
    },
  };
  const unregister = scope?.register(playerId, () => {
    media.pause();
    dispatch({ type: "suspend" });
  });

  return {
    audio,
    unregister,
    get highlighted() {
      return highlightedTurnId(highlight, turns);
    },
    /** The card's Play/Pause button. */
    togglePlay() {
      if (audio.paused) media.play();
      else media.pause();
    },
    /** A turn's "play from" action. */
    playFrom(turnId: string) {
      const seek = turnSeek(turns.find((turn) => turn.id === turnId)?.offsetMs ?? null, {
        playable: true,
        durationMs: 120_000,
      });
      if (!seek.available) throw new Error(`expected a seek for ${turnId}`);
      scope?.claim(playerId);
      const startMs = playFromPositionMs(seek, timelineVersion);
      dispatch({ type: "play_from", turnId, offsetMs: seek.ms, startMs });
      media.seek(startMs);
      media.play();
    },
    /** Playback advancing. */
    advanceTo(ms: number) {
      if (audio.paused) throw new Error(`${playerId} is paused`);
      audio.currentTime = ms;
      report("progress");
    },
  };
}

const callA = [
  { id: "a-u1", offsetMs: 1_000 },
  { id: "a-a1", offsetMs: 5_000 },
  { id: "a-u2", offsetMs: 20_000 },
];
const callB = [
  { id: "b-u1", offsetMs: 2_000 },
  { id: "b-a1", offsetMs: 9_000 },
];

function page() {
  const scope = createPlaybackScope();
  return { a: mountPlayer(scope, "A", callA), b: mountPlayer(scope, "B", callB) };
}

function audible(...players: Array<{ audio: { paused: boolean } }>) {
  return players.filter((player) => !player.audio.paused).length;
}

describe("one recording audible per review page", () => {
  it("normal Play on B pauses playing A", () => {
    const { a, b } = page();
    a.togglePlay();
    a.advanceTo(6_000);
    b.togglePlay();
    expect(a.audio.paused).toBe(true);
    expect(b.audio.paused).toBe(false);
    expect(audible(a, b)).toBe(1);
  });

  it("Play From on B pauses playing A and highlights B's turn", () => {
    const { a, b } = page();
    a.togglePlay();
    a.advanceTo(6_000);
    b.playFrom("b-a1");
    expect(a.audio.paused).toBe(true);
    expect(b.audio.paused).toBe(false);
    expect(b.audio.currentTime).toBe(8_500);
    expect(b.highlighted).toBe("b-a1");
    expect(audible(a, b)).toBe(1);
  });

  it("A keeps its position after the auto-pause and resumes from it", () => {
    const { a, b } = page();
    a.playFrom("a-a1");
    a.advanceTo(7_250);
    b.togglePlay();
    expect(a.audio.currentTime).toBe(7_250);

    a.togglePlay();
    expect(a.audio.paused).toBe(false);
    expect(a.audio.currentTime).toBe(7_250);
    expect(a.highlighted).toBe("a-a1");
  });

  it("returning to A pauses B; a later Play From on A still seeks", () => {
    const { a, b } = page();
    a.togglePlay();
    a.advanceTo(3_000);
    b.togglePlay();
    b.advanceTo(4_000);

    a.togglePlay();
    expect(b.audio.paused).toBe(true);
    expect(b.audio.currentTime).toBe(4_000);
    expect(a.audio.currentTime).toBe(3_000);
    expect(audible(a, b)).toBe(1);

    b.playFrom("b-u1");
    expect(a.audio.paused).toBe(true);
    a.playFrom("a-u2");
    expect(b.audio.paused).toBe(true);
    expect(a.audio.currentTime).toBe(19_500);
    expect(audible(a, b)).toBe(1);
  });

  it("the auto-paused recording stops showing a highlight until it plays again", () => {
    const { a, b } = page();
    a.playFrom("a-u2");
    expect(a.highlighted).toBe("a-u2");

    b.togglePlay();
    expect(a.highlighted).toBeNull();
    expect(b.highlighted).toBeNull();
    b.advanceTo(2_000);
    expect(b.highlighted).toBe("b-u1");

    a.togglePlay();
    expect(b.highlighted).toBeNull();
    expect(a.audio.currentTime).toBe(19_500);
    // Resumes by position: the Play From preroll selection was not revived.
    expect(a.highlighted).toBe("a-a1");
    a.advanceTo(20_000);
    expect(a.highlighted).toBe("a-u2");
  });

  it("a Play From interrupted by another recording is cleared, not left pinned", () => {
    const { a, b } = page();
    a.playFrom("a-u2");
    b.playFrom("b-u1");
    expect(a.highlighted).toBeNull();
    expect(b.highlighted).toBe("b-u1");
  });

  it("an unregistered player is no longer paused by the scope", () => {
    const { a, b } = page();
    a.togglePlay();
    a.unregister?.();
    b.togglePlay();
    expect(a.audio.paused).toBe(false);
  });
});

describe("V1 and V2 recordings on one page", () => {
  it("each Play From uses its recording's preroll; still only one recording audible", () => {
    const scope = createPlaybackScope();
    const v1 = mountPlayer(scope, "V1", callA, 1);
    const v2 = mountPlayer(scope, "V2", callB, 2);

    v1.playFrom("a-a1");
    expect(v1.audio.currentTime).toBe(4_500);
    v2.playFrom("b-a1");
    expect(v2.audio.currentTime).toBe(8_880);
    expect(v2.highlighted).toBe("b-a1");
    expect(v1.audio.paused).toBe(true);
    expect(v1.highlighted).toBeNull();
    expect(audible(v1, v2)).toBe(1);

    v2.advanceTo(9_000);
    expect(v2.highlighted).toBe("b-a1");
    v1.togglePlay();
    expect(v2.audio.paused).toBe(true);
    expect(v1.audio.currentTime).toBe(4_500);
    expect(v1.highlighted).toBe("a-u1");
    v1.advanceTo(5_000);
    expect(v1.highlighted).toBe("a-a1");
  });
});

describe("a single recording behaves as before", () => {
  for (const [label, scope] of [
    ["inside a page scope", () => createPlaybackScope()],
    ["without a scope", () => null],
  ] as const) {
    it(label, () => {
      const solo = mountPlayer(scope(), "solo", callA);
      expect(solo.highlighted).toBeNull();

      solo.playFrom("a-a1");
      expect(solo.audio.currentTime).toBe(4_500);
      expect(solo.highlighted).toBe("a-a1");
      solo.advanceTo(5_000);
      expect(solo.highlighted).toBe("a-a1");

      solo.togglePlay();
      expect(solo.audio.paused).toBe(true);
      expect(solo.highlighted).toBe("a-a1");

      solo.togglePlay();
      expect(solo.audio.paused).toBe(false);
      expect(solo.audio.currentTime).toBe(5_000);
      solo.advanceTo(20_000);
      expect(solo.highlighted).toBe("a-u2");
    });
  }
});
