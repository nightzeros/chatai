import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMedia, REAL_SDP_ANSWER } from "./__fixtures__/fake-media";
import { createVoiceSession, type VoiceSession } from "./voice";
import { parseGateLine } from "./voice-gate";

type Call = { url: string; body: Record<string, unknown> };

const sessions: VoiceSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.end()));
});

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
    gate(seq: number, state: "open" | "closed", inputEndMs: number | null = null, reason = "social") {
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: "gate", seq, state, reason, inputEndMs })}\n`));
    },
    raw(text: string) {
      controller.enqueue(encoder.encode(text));
    },
    close() {
      controller.close();
    },
  };
}

type Stream = ReturnType<typeof gateStream>;

function setup(opts: {
  playbackGate?: boolean;
  gate?: () => Response;
  heartbeat?: () => Response;
  heartbeatIntervalMs?: number;
} = {}) {
  const media = createFakeMedia();
  const calls: Call[] = [];
  const streams: Stream[] = [];
  let clock = 1_000;
  const fetcher: typeof fetch = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, body: JSON.parse(String(init?.body ?? "{}")) });
    if (href.endsWith("/api/v1/voice/sessions")) {
      return Response.json({
        sessionId: "vs_1",
        sdpAnswer: REAL_SDP_ANSWER,
        ephemeral: false,
        conversationId: "conv_1",
        controlToken: "ct_secret",
        heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 5_000,
        ...(opts.playbackGate === false ? {} : { playbackGate: true }),
      });
    }
    if (href.endsWith("/gate")) {
      if (opts.gate) return opts.gate();
      const stream = gateStream();
      streams.push(stream);
      return stream.response;
    }
    if (href.endsWith("/heartbeat")) {
      return opts.heartbeat ? opts.heartbeat() : Response.json({ state: "healthy", nextHeartbeatMs: 5_000 });
    }
    return Response.json({ ended: true });
  };
  const session = createVoiceSession({
    apiUrl: "https://chat.example.com",
    assistantId: "asst_pub",
    visitorId: "visitor_12345",
    history: [],
    fetch: fetcher,
    media,
    headers: async () => ({ "Content-Type": "application/json" }),
    onChange: () => undefined,
    now: () => clock,
    controlHealth: { reconnectIntervalMs: 20, now: () => Date.now() },
    playbackGate: { reconnectMinMs: 5, reconnectMaxMs: 20 },
  });
  sessions.push(session);
  return {
    session,
    calls,
    streams,
    audio: () => media.audio[0]!,
    track: () => media.tracks[0]!,
    channel: () => media.peers[0]!.channel,
    gateCalls: () => calls.filter((call) => call.url.endsWith("/gate")),
    advance(ms: number) {
      clock += ms;
    },
    async connect() {
      await session.start();
      media.peers[0]!.channel.receive({ type: "session.started" });
      await vi.waitFor(() => expect(streams).toHaveLength(1));
    },
  };
}

const assistantTurns = (session: VoiceSession) =>
  session.snapshot().turns.filter((turn) => turn.role === "assistant").map((turn) => turn.text);

describe("Voice playback gate (widget)", () => {
  it("declares playback_gate and opens the gate stream with the control token only", async () => {
    const t = setup();
    await t.connect();
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    expect(mint.body.capabilities).toEqual(["heartbeat", "playback_gate"]);
    expect(t.gateCalls()[0]).toEqual({
      url: "https://chat.example.com/api/v1/voice/sessions/vs_1/gate",
      body: { token: "ct_secret" },
    });
    expect(JSON.stringify(t.session.snapshot())).not.toContain("ct_secret");
  });

  it("assistant audio is muted from the start and unmuted only by an open decision", async () => {
    const t = setup();
    await t.connect();
    expect(t.audio().muted).toBe(true);

    t.streams[0]!.gate(0, "closed", null, "start");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.audio().muted).toBe(true);

    t.streams[0]!.gate(1, "open", 900);
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));
    t.streams[0]!.gate(2, "closed", 900, "pending_backend");
    await vi.waitFor(() => expect(t.audio().muted).toBe(true));
    // The gate only ever touches playback, never the microphone.
    expect(t.track().enabled).toBe(true);
  });

  it("unapproved speech has no caption and shows processing; approved speech is shown", async () => {
    const t = setup();
    await t.connect();
    const channel = t.channel();
    t.streams[0]!.gate(0, "closed", null, "start");

    channel.receive({ type: "session.input_transcript.delta", delta: "I'm hungry", start_ms: 0, end_ms: 900 });
    t.advance(1_000);
    channel.receive({
      type: "session.output_transcript.delta",
      delta: "Oh no! What would you like to eat?",
      start_ms: 1_000,
      end_ms: 2_000,
    });
    expect(assistantTurns(t.session)).toEqual([]);
    expect(t.session.snapshot().phase).toBe("processing");

    t.streams[0]!.gate(1, "open", 900, "backend_answer");
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));
    t.advance(1_500);
    channel.receive({
      type: "session.output_transcript.delta",
      delta: "I can help with appointments and opening hours.",
      start_ms: 3_000,
      end_ms: 4_500,
    });
    expect(assistantTurns(t.session)).toEqual(["I can help with appointments and opening hours."]);
    expect(t.session.snapshot().phase).toBe("assistant_speaking");
  });

  it("closes locally as soon as the visitor speaks past the approved turn; stale approvals stay closed", async () => {
    const t = setup();
    await t.connect();
    const channel = t.channel();
    t.streams[0]!.gate(1, "open", 900);
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));

    // A late transcript of the approved turn itself does not close.
    channel.receive({ type: "session.input_transcript.delta", delta: " there", start_ms: 400, end_ms: 900 });
    expect(t.audio().muted).toBe(false);

    // New speech: muted at once, without waiting for the server.
    channel.receive({ type: "session.input_transcript.delta", delta: "I'm hungry", start_ms: 2_000, end_ms: 2_800 });
    expect(t.audio().muted).toBe(true);
    channel.receive({ type: "session.output_transcript.delta", delta: "Let's cook!", start_ms: 3_000, end_ms: 3_400 });
    expect(assistantTurns(t.session)).toEqual([]);

    // An approval that predates that speech is stale.
    t.streams[0]!.gate(2, "open", 900);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.audio().muted).toBe(true);
    // One that covers it opens.
    t.streams[0]!.gate(3, "open", 2_800, "backend_answer");
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));
  });

  it("stays muted while the gate stream is down and reconnects to the current decision", async () => {
    const t = setup();
    await t.connect();
    t.streams[0]!.gate(1, "open", 900);
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));

    t.streams[0]!.close();
    await vi.waitFor(() => expect(t.audio().muted).toBe(true));
    await vi.waitFor(() => expect(t.streams).toHaveLength(2));
    expect(t.audio().muted).toBe(true);

    t.streams[1]!.gate(1, "open", 900);
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));
  });

  it("an end event stops the gate for good: muted, no reconnects", async () => {
    const t = setup();
    await t.connect();
    t.streams[0]!.gate(1, "open", null);
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));
    t.streams[0]!.raw(`${JSON.stringify({ type: "end" })}\n`);
    await vi.waitFor(() => expect(t.audio().muted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(t.gateCalls()).toHaveLength(1);
  });

  it("an unknown session (404) is not retried and playback stays muted", async () => {
    const t = setup({ gate: () => Response.json({ error: "Not found" }, { status: 404 }) });
    await t.session.start();
    t.channel().receive({ type: "session.started" });
    await vi.waitFor(() => expect(t.gateCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(t.gateCalls()).toHaveLength(1);
    expect(t.audio().muted).toBe(true);
  });

  it("control-health muting takes priority over an open gate", async () => {
    let healthy = true;
    const t = setup({
      heartbeatIntervalMs: 20,
      heartbeat: () => {
        if (!healthy) throw new TypeError("Failed to fetch");
        return Response.json({ state: "healthy", nextHeartbeatMs: 20 });
      },
    });
    await t.connect();
    t.streams[0]!.gate(1, "open", null);
    await vi.waitFor(() => expect(t.audio().muted).toBe(false));

    healthy = false;
    await vi.waitFor(() => expect(t.session.snapshot().connection).toBe("reconnecting"));
    expect(t.audio().muted).toBe(true);
    expect(t.track().enabled).toBe(false);

    healthy = true;
    await vi.waitFor(() => expect(t.session.snapshot().connection).toBe("connected"));
    expect(t.audio().muted).toBe(false);
    expect(t.track().enabled).toBe(true);
  });

  it("an older server without the gate keeps playback as before", async () => {
    const t = setup({ playbackGate: false });
    await t.session.start();
    t.channel().receive({ type: "session.started" });
    expect(t.audio().muted).toBe(false);
    t.channel().receive({ type: "session.output_transcript.delta", delta: "Hello!", start_ms: 0, end_ms: 400 });
    expect(assistantTurns(t.session)).toEqual(["Hello!"]);
    expect(t.gateCalls()).toHaveLength(0);
  });

  it("ignores malformed stream lines", () => {
    expect(parseGateLine("not json")).toBeNull();
    expect(parseGateLine(JSON.stringify({ type: "gate", seq: "1", state: "open" }))).toBeNull();
    expect(parseGateLine(JSON.stringify({ type: "gate", seq: 1, state: "maybe" }))).toBeNull();
    expect(parseGateLine(JSON.stringify({ type: "keepalive" }))).toEqual({ type: "keepalive" });
    expect(parseGateLine(JSON.stringify({ type: "gate", seq: 2, state: "open", inputEndMs: 900 }))).toEqual({
      type: "gate",
      decision: { seq: 2, state: "open", inputEndMs: 900 },
    });
  });
});
