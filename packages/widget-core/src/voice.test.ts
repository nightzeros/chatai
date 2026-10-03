import { afterEach, describe, expect, it } from "vitest";

import {
  createFakeMedia,
  MOCK_SDP_ANSWER,
  REAL_SDP_ANSWER,
  type FakeMedia,
} from "./__fixtures__/fake-media";
import { createVoiceSession, type VoiceSession, type VoiceSessionSnapshot } from "./voice";

type Call = { url: string; body: Record<string, unknown>; init: RequestInit };

const sessions: VoiceSession[] = [];

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.end()));
});

function setup(opts: {
  media?: FakeMedia;
  mint?: () => Response | Promise<Response>;
  end?: () => Response | Promise<Response>;
  conversationId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
} = {}) {
  const media = opts.media ?? createFakeMedia();
  const calls: Call[] = [];
  const snapshots: VoiceSessionSnapshot[] = [];
  let clock = 1_000;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")), init: init ?? {} });
    if (String(url).endsWith("/api/v1/voice/sessions")) {
      return opts.mint
        ? opts.mint()
        : Response.json({
            sessionId: "vs_1",
            sdpAnswer: REAL_SDP_ANSWER,
            providerSessionId: "prov_1",
            ephemeral: false,
            conversationId: "conv_1",
          });
    }
    return opts.end ? opts.end() : Response.json({ ended: true });
  };
  const session = createVoiceSession({
    apiUrl: "https://chat.example.com",
    assistantId: "asst_pub",
    visitorId: "visitor_12345",
    conversationId: opts.conversationId,
    history: opts.history ?? [],
    fetch: fetcher,
    media,
    headers: async () => ({ "Content-Type": "application/json", "X-ChatAI-Signature": "sig" }),
    onChange: (snap) => snapshots.push(snap),
    now: () => clock,
  });
  sessions.push(session);
  return {
    session,
    media,
    calls,
    snapshots,
    advance(ms: number) {
      clock += ms;
    },
    peer: () => media.peers[0]!,
  };
}

describe("createVoiceSession", () => {
  it("calls fetch unbound, like native window.fetch requires", async () => {
    const urls: string[] = [];
    // Native fetch throws "Illegal invocation" when called as a method of another object.
    const nativeLikeFetch = function (this: unknown, url: RequestInfo | URL) {
      if (this !== undefined && this !== globalThis) {
        return Promise.reject(new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"));
      }
      urls.push(String(url));
      return Promise.resolve(
        String(url).endsWith("/api/v1/voice/sessions")
          ? Response.json({ sessionId: "vs_1", sdpAnswer: REAL_SDP_ANSWER, ephemeral: false, conversationId: null })
          : Response.json({ ended: true }),
      );
    } as typeof fetch;
    const session = createVoiceSession({
      apiUrl: "https://chat.example.com",
      assistantId: "asst_pub",
      visitorId: "visitor_12345",
      history: [],
      fetch: nativeLikeFetch,
      media: createFakeMedia(),
      headers: async () => ({ "Content-Type": "application/json" }),
      onChange: () => undefined,
    });
    await session.start();
    expect(session.snapshot().error).toBeUndefined();
    expect(session.snapshot().connection).not.toBe("failed");
    await session.end();
    expect(urls).toEqual([
      "https://chat.example.com/api/v1/voice/sessions",
      "https://chat.example.com/api/v1/voice/sessions/vs_1/end",
    ]);
  });

  it("asks for the mic, then mints through ChatAI with the widget source, history and conversation", async () => {
    const t = setup({
      conversationId: "conv_text",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ],
    });
    await t.session.start();

    expect(t.snapshots.map((snap) => snap.connection).slice(0, 2)).toEqual(["requesting_mic", "connecting"]);
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    expect(mint.body).toMatchObject({
      assistantId: "asst_pub",
      visitorId: "visitor_12345",
      source: "widget",
      conversationId: "conv_text",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ],
    });
    expect(String(mint.body.sdpOffer)).toContain("v=0");
    expect((mint.init.headers as Record<string, string>)["X-ChatAI-Signature"]).toBe("sig");
    expect(t.peer().channelLabels).toEqual(["oai-events"]);
    expect(t.peer().remoteDescription).toEqual({ type: "answer", sdp: REAL_SDP_ANSWER });
    expect(t.session.snapshot()).toMatchObject({ ephemeral: false, conversationId: "conv_1" });
  });

  it("becomes connected on session.started and derives phases from provider events", async () => {
    const t = setup();
    await t.session.start();
    const channel = t.peer().channel;

    channel.receive({ type: "session.started" });
    expect(t.session.snapshot()).toMatchObject({ connection: "connected", phase: "listening" });

    channel.receive({ type: "session.input_transcript.delta", delta: "How many members?", start_ms: 0, end_ms: 900 });
    expect(t.session.snapshot().phase).toBe("user_speaking");

    t.advance(1_000);
    channel.receive({ type: "session.delegation.created", offset_ms: 900, delegation: { id: "d1" } });
    expect(t.session.snapshot().phase).toBe("processing");

    // An immediate filler ("let me check") does not end the lookup…
    t.advance(300);
    channel.receive({ type: "session.output_transcript.delta", delta: "Let me check. ", start_ms: 1_000, end_ms: 1_600 });
    expect(t.session.snapshot().phase).toBe("processing");

    // …the grounded answer does.
    t.advance(2_000);
    channel.receive({ type: "session.output_transcript.delta", delta: "Zenith has 17 members.", start_ms: 3_300, end_ms: 5_000 });
    expect(t.session.snapshot().phase).toBe("assistant_speaking");
    expect(t.session.snapshot().turns.map((turn) => [turn.role, turn.text])).toEqual([
      ["user", "How many members?"],
      ["assistant", "Let me check. Zenith has 17 members."],
    ]);
  });

  it("recognizes the mock provider and skips the WebRTC answer", async () => {
    const t = setup({
      mint: () => Response.json({ sessionId: "vs_1", sdpAnswer: MOCK_SDP_ANSWER, ephemeral: true, conversationId: null }),
    });
    await t.session.start();

    expect(t.peer().remoteDescription).toBeNull();
    expect(t.session.snapshot()).toMatchObject({ connection: "connected", mock: true, ephemeral: true, conversationId: null });
  });

  it("maps a denied microphone to a clear error and never mints", async () => {
    const t = setup({ media: createFakeMedia({ micError: new DOMException("denied", "NotAllowedError") }) });
    await t.session.start();

    expect(t.session.snapshot()).toMatchObject({ connection: "failed", phase: "error", error: { code: "mic_denied" } });
    expect(t.calls).toHaveLength(0);
    expect(t.media.audioContexts[0]?.closed).toBe(true);
  });

  it("maps a missing microphone separately from a denied one", async () => {
    const t = setup({ media: createFakeMedia({ micError: new DOMException("none", "NotFoundError") }) });
    await t.session.start();
    expect(t.session.snapshot().error?.code).toBe("mic_unavailable");
  });

  it.each([
    [403, { error: "Voice is not enabled for this assistant." }, "voice_unavailable"],
    [403, { error: "This domain is not allowed to use the widget." }, "server"],
    [429, { error: "Rate limit exceeded." }, "rate_limited"],
    [503, { error: "Voice provider is not configured on this instance." }, "voice_unavailable"],
    [402, { error: "Voice isn't available right now.", reason: "voice_minutes_exhausted" }, "voice_unavailable"],
    [429, { error: "Voice isn't available right now.", reason: "voice_concurrency_limit" }, "voice_unavailable"],
    [403, { error: "Voice isn't available right now.", reason: "voice_unavailable" }, "voice_unavailable"],
  ])("maps a %i mint response to %s without leaking server internals", async (status, body, code) => {
    const t = setup({ mint: () => Response.json(body, { status }) });
    await t.session.start();

    const snap = t.session.snapshot();
    expect(snap).toMatchObject({ connection: "failed", error: { code } });
    expect(snap.error?.message).not.toMatch(/instance|provider/i);
    expect(t.media.tracks[0]?.stopped).toBe(true);
    expect(t.peer().closed).toBe(true);
  });

  it("reports an offline network as a network error", async () => {
    const t = setup({
      mint: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await t.session.start();
    expect(t.session.snapshot().error?.code).toBe("network");
  });

  it("end() releases the mic, WebRTC and audio at once, then finalizes the server session", async () => {
    const t = setup();
    await t.session.start();
    t.peer().channel.receive({ type: "session.started" });

    await t.session.end();

    expect(t.media.tracks[0]?.stopped).toBe(true);
    expect(t.peer().closed).toBe(true);
    expect(t.media.audio[0]?.srcObject).toBeNull();
    expect(t.media.audioContexts[0]?.closed).toBe(true);
    const end = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions/vs_1/end"))!;
    expect(end.body).toEqual({ reason: "close_requested", visitorId: "visitor_12345", source: "widget" });
    expect(t.session.snapshot()).toMatchObject({ connection: "ended", phase: "ended" });
  });

  it("end({ keepalive }) lets the end request outlive a closing page", async () => {
    const t = setup();
    await t.session.start();
    await t.session.end("close_requested", { keepalive: true });

    const end = t.calls.find((call) => call.url.endsWith("/end"))!;
    expect(end.init.keepalive).toBe(true);
    expect((end.init.headers as Record<string, string>)["X-ChatAI-Signature"]).toBe("sig");
  });

  it("ending while the mic prompt is open never mints and stops the late mic stream", async () => {
    let release!: () => void;
    const media = createFakeMedia({ micDelay: new Promise<void>((resolve) => (release = resolve)) });
    const t = setup({ media });
    const started = t.session.start();
    await t.session.end();
    release();
    await started;

    expect(t.calls).toHaveLength(0);
    expect(media.tracks[0]?.stopped).toBe(true);
  });

  it("a failed media connection stops Voice and ends the server session as connection_lost", async () => {
    const t = setup();
    await t.session.start();
    t.peer().setConnectionState("failed");
    await flush();

    expect(t.session.snapshot()).toMatchObject({ connection: "failed", error: { code: "media_failed" } });
    expect(t.media.tracks[0]?.stopped).toBe(true);
    const end = t.calls.find((call) => call.url.endsWith("/end"));
    expect(end?.body.reason).toBe("connection_lost");
  });

  it("a provider-side close (session.closed) ends the session and keeps the transcript", async () => {
    const t = setup();
    await t.session.start();
    const channel = t.peer().channel;
    channel.receive({ type: "session.started" });
    channel.receive({ type: "session.input_transcript.delta", delta: "Hello", start_ms: 0, end_ms: 400 });
    channel.receive({ type: "session.output_transcript.delta", delta: "Hi there!", start_ms: 600, end_ms: 1_200 });
    channel.receive({ type: "session.closed", reason: "max_duration" });
    await flush();

    expect(t.session.snapshot()).toMatchObject({ connection: "ended" });
    expect(t.session.snapshot().turns).toHaveLength(2);
    expect(t.calls.some((call) => call.url.endsWith("/end"))).toBe(true);
  });

  it("never sends provider credentials: the only secrets on the wire are ChatAI headers", async () => {
    const t = setup();
    await t.session.start();
    const serialized = JSON.stringify(t.calls.map((call) => call.body));
    expect(serialized).not.toMatch(/sk-|api[_-]?key|bearer/i);
  });

  it("a Voice-minutes refusal shows neutral copy with no plan details", async () => {
    const t = setup({
      mint: () =>
        Response.json(
          { error: "This account's Voice minutes for the current period are used up.", reason: "voice_minutes_exhausted" },
          { status: 402 },
        ),
    });
    await t.session.start();
    const message = t.session.snapshot().error?.message ?? "";
    expect(message).toBe("Voice isn't available right now. You can keep typing.");
    expect(message).not.toMatch(/minute|plan|limit|quota/i);
  });

  it("a call ChatAI ended reports a neutral notice, not an error", async () => {
    const t = setup({
      end: () =>
        Response.json({ sessionId: "vs_1", status: "ended", endReason: "voice_unavailable", billableSeconds: 135 }),
    });
    await t.session.start();
    const channel = t.peer().channel;
    channel.receive({ type: "session.started" });
    channel.receive({ type: "session.closed", reason: "close_requested" });
    await flush();
    await flush();

    const snap = t.session.snapshot();
    expect(snap).toMatchObject({
      connection: "ended",
      phase: "ended",
      endReason: "voice_unavailable",
      notice: "Voice is unavailable for the rest of this conversation, but we can keep chatting here.",
    });
    expect(snap.error).toBeUndefined();
    expect(snap.notice).not.toMatch(/minute|plan|limit|quota|billing|usage/i);
  });

  it("an older server's usage_limit is kept only in neutral form on the client", async () => {
    const t = setup({ end: () => Response.json({ sessionId: "vs_1", endReason: "usage_limit" }) });
    await t.session.start();
    t.peer().channel.receive({ type: "session.closed", reason: "close_requested" });
    await flush();
    await flush();
    expect(t.session.snapshot().endReason).toBe("voice_unavailable");
    expect(JSON.stringify(t.session.snapshot())).not.toMatch(/usage_limit|quota|minute/i);
  });

  it("a media drop after a server-side usage end is shown as ended, not failed", async () => {
    const t = setup({ end: () => Response.json({ sessionId: "vs_1", endReason: "voice_unavailable" }) });
    await t.session.start();
    t.peer().channel.receive({ type: "session.started" });
    t.peer().setConnectionState("failed");
    await flush();
    await flush();

    expect(t.session.snapshot()).toMatchObject({ connection: "ended", endReason: "voice_unavailable" });
    expect(t.session.snapshot().error).toBeUndefined();
  });

  it("a superseded call explains that Voice moved to another tab", async () => {
    const t = setup({ end: () => Response.json({ sessionId: "vs_1", endReason: "superseded" }) });
    await t.session.start();
    t.peer().channel.receive({ type: "session.closed", reason: "close_requested" });
    await flush();
    await flush();
    expect(t.session.snapshot().notice).toMatch(/another tab/i);
  });
});
