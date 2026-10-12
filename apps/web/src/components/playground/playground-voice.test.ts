import { VOICE_CLIENT_CAPABILITIES } from "@nightzeros/chatai-widget-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildPlaygroundMintBody, createPlaygroundPlayback, type PlaygroundPlayback } from "./playground-voice";

/** A gate stream the test writes NDJSON lines into. */
function gateStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }),
    gate(seq: number, state: "open" | "closed", inputEndMs: number | null = null) {
      controller.enqueue(
        encoder.encode(`${JSON.stringify({ type: "gate", seq, state, reason: "social", inputEndMs })}\n`),
      );
    },
  };
}

const players: PlaygroundPlayback[] = [];

afterEach(() => {
  players.splice(0).forEach((player) => player.stop());
});

function setup() {
  const stream = gateStream();
  const fetcher = vi.fn<typeof fetch>(async () => stream.response);
  const muted: boolean[] = [];
  const gateChanges: boolean[] = [];
  const playback = createPlaygroundPlayback({
    setAudioMuted: (value) => muted.push(value),
    onGateChange: (open) => gateChanges.push(open),
    fetch: fetcher,
  });
  players.push(playback);
  return { stream, fetcher, muted, gateChanges, playback, lastMuted: () => muted.at(-1) };
}

describe("buildPlaygroundMintBody", () => {
  const input = {
    assistantId: "asst_pub",
    sdpOffer: "v=0",
    visitorId: "visitor-1",
    history: [{ role: "user" as const, content: "hi" }],
    recordingConsent: false,
  };

  it("declares exactly the widget's client capabilities, so the server gates the Playground too", () => {
    const body = buildPlaygroundMintBody(input);
    expect(body.capabilities).toEqual([...VOICE_CLIENT_CAPABILITIES]);
    expect(body.capabilities).toContain("playback_gate");
    expect(body.source).toBe("playground");
  });

  it("omits optional fields the server would reject when empty", () => {
    const body = buildPlaygroundMintBody({ ...input, conversationId: null });
    expect(body).not.toHaveProperty("conversationId");
    expect(body).not.toHaveProperty("recordingConsent");
    expect(JSON.parse(JSON.stringify(buildPlaygroundMintBody(input)))).not.toHaveProperty("conversationId");
  });

  it("binds the conversation and records consent only when given", () => {
    const body = buildPlaygroundMintBody({ ...input, conversationId: "conv_1", recordingConsent: true });
    expect(body).toMatchObject({ conversationId: "conv_1", recordingConsent: true, history: input.history });
  });
});

describe("createPlaygroundPlayback", () => {
  it("plays normally when the server does not gate playback", () => {
    const { playback, lastMuted } = setup();
    expect(playback.audible()).toBe(true);
    playback.refresh();
    expect(lastMuted()).toBe(false);
  });

  it("keeps audio muted from the moment the gate starts until ChatAI approves", async () => {
    const { playback, stream, fetcher, lastMuted, gateChanges } = setup();
    playback.startGate("vs/1", "control-token");

    expect(playback.audible()).toBe(false);
    expect(lastMuted()).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/voice/sessions/vs%2F1/gate",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "control-token" }) }),
    );

    stream.gate(1, "open", 1_000);
    await vi.waitFor(() => expect(playback.audible()).toBe(true));
    expect(lastMuted()).toBe(false);
    expect(gateChanges).toEqual([true]);
  });

  it("closes locally on new visitor speech without waiting for the server", async () => {
    const { playback, stream, lastMuted } = setup();
    playback.startGate("vs_1", "control-token");
    stream.gate(1, "open", 1_000);
    await vi.waitFor(() => expect(playback.audible()).toBe(true));

    playback.noteInput(500);
    expect(playback.audible()).toBe(true);

    playback.noteInput(1_200);
    expect(playback.audible()).toBe(false);
    expect(lastMuted()).toBe(true);
  });

  it("keeps control-health muting independent of the gate", async () => {
    const { playback, stream, lastMuted } = setup();
    playback.startGate("vs_1", "control-token");
    stream.gate(1, "open", 1_000);
    await vi.waitFor(() => expect(playback.audible()).toBe(true));

    playback.setControlMuted(true);
    expect(lastMuted()).toBe(true);
    expect(playback.audible()).toBe(true);

    playback.setControlMuted(false);
    expect(lastMuted()).toBe(false);
  });

  it("stays muted while control is lost even if the gate opens", async () => {
    const { playback, stream, lastMuted } = setup();
    playback.setControlMuted(true);
    playback.startGate("vs_1", "control-token");
    stream.gate(1, "open", 1_000);
    await vi.waitFor(() => expect(playback.audible()).toBe(true));
    expect(lastMuted()).toBe(true);
  });

  it("stop never unmutes the ending session's audio; the next session applies its own state", async () => {
    const { playback, stream, muted, lastMuted } = setup();
    playback.startGate("vs_1", "control-token");
    playback.setControlMuted(true);
    stream.gate(1, "closed");
    const before = muted.length;

    playback.stop();
    expect(muted).toHaveLength(before);
    expect(lastMuted()).toBe(true);

    // Both mute reasons were reset: a new ungated session plays once its track arrives.
    expect(playback.audible()).toBe(true);
    playback.refresh();
    expect(lastMuted()).toBe(false);
  });
});
