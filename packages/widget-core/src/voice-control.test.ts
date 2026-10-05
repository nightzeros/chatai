import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeMedia, REAL_SDP_ANSWER } from "./__fixtures__/fake-media";
import { createVoiceSession, visitorEndReason, VOICE_END_NOTICES, type VoiceSession } from "./voice";
import { isVoiceActive } from "./voice-state";

type Call = { url: string; body: Record<string, unknown> };
type Reply = Response | Promise<Response>;

const sessions: VoiceSession[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.end()));
  vi.useRealTimers();
});

const heartbeatJson = (state: string, extra: Record<string, unknown> = {}) =>
  Response.json({ state, nextHeartbeatMs: state === "healthy" ? 5_000 : 2_000, ...extra });

function setup(opts: {
  heartbeat?: (index: number) => Reply;
  end?: () => Reply;
  controlToken?: string | null;
  requestTimeoutMs?: number;
} = {}) {
  const media = createFakeMedia();
  const calls: Call[] = [];
  const connections: string[] = [];
  let beats = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, body: JSON.parse(String(init?.body ?? "{}")) });
    if (href.endsWith("/api/v1/voice/sessions")) {
      return Response.json({
        sessionId: "vs_1",
        sdpAnswer: REAL_SDP_ANSWER,
        ephemeral: false,
        conversationId: "conv_1",
        ...(opts.controlToken === null ? {} : { controlToken: opts.controlToken ?? "ct_secret", heartbeatIntervalMs: 5_000 }),
      });
    }
    if (href.endsWith("/heartbeat")) {
      const index = beats++;
      return opts.heartbeat ? opts.heartbeat(index) : heartbeatJson("healthy");
    }
    return opts.end ? opts.end() : Response.json({ ended: true });
  };
  const session = createVoiceSession({
    apiUrl: "https://chat.example.com",
    assistantId: "asst_pub",
    visitorId: "visitor_12345",
    history: [],
    fetch: fetcher,
    media,
    headers: async () => ({ "Content-Type": "application/json", "X-ChatAI-Signature": "sig" }),
    onChange: (snap) => {
      if (connections.at(-1) !== snap.connection) connections.push(snap.connection);
    },
    now: () => Date.now(),
    ...(opts.requestTimeoutMs ? { controlHealth: { requestTimeoutMs: opts.requestTimeoutMs } } : {}),
  });
  sessions.push(session);
  const count = (suffix: string) => calls.filter((call) => call.url.endsWith(suffix)).length;
  return {
    session,
    media,
    calls,
    connections,
    track: () => media.tracks[0]!,
    audio: () => media.audio[0]!,
    peer: () => media.peers[0]!,
    heartbeats: () => count("/heartbeat"),
    mints: () => count("/api/v1/voice/sessions"),
    ends: () => calls.filter((call) => call.url.endsWith("/end")),
    async connect() {
      await session.start();
      media.peers[0]!.channel.receive({ type: "session.started" });
    },
  };
}

const failing = () => {
  throw new TypeError("Failed to fetch");
};

describe("Widget Voice control health", () => {
  it("declares the heartbeat capability and heartbeats with the control token only", async () => {
    const t = setup();
    await t.connect();
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    expect(mint.body.capabilities).toEqual(["heartbeat"]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.heartbeats()).toBe(6);
    const beat = t.calls.find((call) => call.url.endsWith("/heartbeat"))!;
    expect(beat.url).toBe("https://chat.example.com/api/v1/voice/sessions/vs_1/heartbeat");
    expect(beat.body).toEqual({ token: "ct_secret" });
    expect(t.session.snapshot()).toMatchObject({ connection: "connected", phase: "listening" });
    expect(JSON.stringify(t.session.snapshot())).not.toContain("ct_secret");
  });

  it("an older server without a control token gets no heartbeats", async () => {
    const t = setup({ controlToken: null });
    await t.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.heartbeats()).toBe(0);
    expect(t.session.snapshot().connection).toBe("connected");
  });

  it("one missed heartbeat causes no visible disruption", async () => {
    const t = setup({ heartbeat: (i) => (i === 0 ? failing() : heartbeatJson("healthy")) });
    await t.connect();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.session.snapshot().connection).toBe("connected");
    expect(t.track().enabled).toBe(true);
    expect(t.audio().muted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.session.snapshot().connection).toBe("connected");
  });

  it("two missed heartbeats reconnect: mic and assistant muted, media kept, text still blocked", async () => {
    const t = setup({ heartbeat: failing });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);

    const snap = t.session.snapshot();
    expect(snap).toMatchObject({ connection: "reconnecting", phase: "reconnecting" });
    expect(t.track().enabled).toBe(false);
    expect(t.track().stopped).toBe(false);
    expect(t.audio().muted).toBe(true);
    expect(t.peer().closed).toBe(false);
    expect(isVoiceActive(snap.connection)).toBe(true);
    expect(t.ends()).toHaveLength(0);
  });

  it("~12 s without a successful heartbeat reconnects even before two failures", async () => {
    const t = setup({ heartbeat: () => new Promise<Response>(() => undefined), requestTimeoutMs: 60_000 });
    await t.connect();
    await vi.advanceTimersByTimeAsync(11_500);
    expect(t.session.snapshot().connection).toBe("connected");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
  });

  it("server-reported degraded reconnects; provider activity is frozen until control returns", async () => {
    let state = "degraded";
    const t = setup({ heartbeat: () => heartbeatJson(state) });
    await t.connect();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");

    const channel = t.peer().channel;
    channel.receive({ type: "session.input_transcript.delta", delta: "unsupervised", start_ms: 0, end_ms: 500 });
    channel.receive({ type: "session.output_transcript.delta", delta: "unsupervised answer", start_ms: 600, end_ms: 900 });
    expect(t.session.snapshot().phase).toBe("reconnecting");
    expect(t.session.snapshot().turns).toHaveLength(0);

    state = "healthy";
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.session.snapshot()).toMatchObject({ connection: "connected", phase: "listening" });
    expect(t.track().enabled).toBe(true);
    expect(t.audio().muted).toBe(false);
    expect(t.mints()).toBe(1);
  });

  it("no recovery within 20 s ends Voice once, restores text and never restarts Voice", async () => {
    const t = setup({ heartbeat: failing, end: failing });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(19_500);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);

    const snap = t.session.snapshot();
    expect(snap).toMatchObject({
      connection: "ended",
      phase: "ended",
      endReason: "disconnected",
      notice: "Voice disconnected. You can keep typing here.",
    });
    expect(snap.error).toBeUndefined();
    expect(isVoiceActive(snap.connection)).toBe(false);
    expect(t.track().stopped).toBe(true);
    expect(t.peer().closed).toBe(true);
    expect(t.ends()).toHaveLength(1);
    expect(t.ends()[0]!.body.reason).toBe("connection_lost");

    const beats = t.heartbeats();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.heartbeats()).toBe(beats);
    expect(t.mints()).toBe(1);
    expect(t.ends()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["idle", "Voice ended after a period of silence. You can keep typing here."],
    ["disconnected", "Voice disconnected. You can keep typing here."],
    ["max_duration", "Voice reached its maximum length. You can keep typing here."],
  ])("a heartbeat reporting ended/%s shows its copy", async (endReason, notice) => {
    const t = setup({ heartbeat: () => heartbeatJson("ended", { endReason }) });
    await t.connect();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.session.snapshot()).toMatchObject({ connection: "ended", endReason, notice });
    expect(t.session.snapshot().error).toBeUndefined();
    expect(t.track().stopped).toBe(true);
    expect(t.ends()).toHaveLength(1);
  });

  it("a lost/unknown session stays muted through the close window, then ends regardless", async () => {
    let answer: () => Response = () => Response.json({ error: "Not found" }, { status: 404 });
    const t = setup({ heartbeat: () => answer() });
    await t.connect();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    expect(t.track().enabled).toBe(false);

    // Nothing revives a lost session.
    answer = () => heartbeatJson("healthy");
    await vi.advanceTimersByTimeAsync(9_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.session.snapshot()).toMatchObject({ connection: "ended", endReason: "disconnected" });
  });

  it.each([
    [421, { error: "misrouted" }],
    [429, { error: "Rate limit exceeded." }],
  ])("an occasional %i between healthy answers never disrupts the call", async (status, body) => {
    const t = setup({ heartbeat: (i) => (i % 2 === 0 ? Response.json(body, { status }) : heartbeatJson("healthy")) });
    await t.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.session.snapshot().connection).toBe("connected");
    expect(t.track().enabled).toBe(true);
    expect(t.ends()).toHaveLength(0);
  });

  it.each([
    [421, { error: "misrouted" }],
    [429, { error: "Rate limit exceeded." }],
  ])("a %i is not proof of control: without any healthy answer the call mutes after ~12 s", async (status, body) => {
    const t = setup({ heartbeat: () => Response.json(body, { status }) });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    // Neither answer counts as a failure.
    expect(t.session.snapshot().connection).toBe("connected");
    await vi.advanceTimersByTimeAsync(2_500);
    expect(t.session.snapshot().connection).toBe("reconnecting");
  });

  it("a manual end while reconnecting ends once and clears every timer", async () => {
    const t = setup({ heartbeat: failing });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");

    await t.session.end();
    expect(t.session.snapshot().connection).toBe("ended");
    expect(t.ends()).toHaveLength(1);
    expect(t.ends()[0]!.body.reason).toBe("close_requested");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.ends()).toHaveLength(1);
    await t.session.end();
    expect(t.ends()).toHaveLength(1);
  });

  it("a media drop or provider close while reconnecting is the neutral disconnect, not an error", async () => {
    const t = setup({ heartbeat: failing, end: failing });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    t.peer().setConnectionState("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(t.session.snapshot()).toMatchObject({ connection: "ended", endReason: "disconnected" });
    expect(t.session.snapshot().error).toBeUndefined();

    const u = setup({ heartbeat: failing });
    await u.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    u.peer().channel.receive({ type: "session.closed", reason: "provider" });
    await vi.advanceTimersByTimeAsync(0);
    expect(u.session.snapshot()).toMatchObject({ connection: "ended", endReason: "disconnected" });
    expect(u.ends()).toHaveLength(1);
  });

  it("a recovery racing the grace expiry cannot revive an ended call", async () => {
    let release!: (response: Response) => void;
    let hang = false;
    const t = setup({
      heartbeat: () => (hang ? new Promise<Response>((resolve) => (release = resolve)) : failing()),
      requestTimeoutMs: 60_000,
    });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    hang = true;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(t.session.snapshot().connection).toBe("ended");
    release(heartbeatJson("healthy"));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.session.snapshot().connection).toBe("ended");
    expect(t.track().enabled).toBe(false);
    expect(t.audio().muted).toBe(true);
  });
});

describe("server restart vs same-runtime sideband recovery", () => {
  it("process restart: orphan recovery hangs up the old call, which ends and never shows Connected again", async () => {
    // Old process killed → heartbeats fail; the restarted process then finds the
    // orphan (lost), recovers it and hangs up the provider session.
    const answers: Array<() => Response> = [
      failing,
      failing,
      () => heartbeatJson("lost"),
      () => heartbeatJson("lost"),
    ];
    const t = setup({ heartbeat: (i) => (answers[i] ?? (() => heartbeatJson("ended")))() });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    expect(t.track().enabled).toBe(false);

    // The recovery hangup reaches the browser's peer as session.closed.
    t.peer().channel.receive({ type: "session.closed", reason: "close_requested" });
    await vi.advanceTimersByTimeAsync(0);

    expect(t.session.snapshot()).toMatchObject({
      connection: "ended",
      endReason: "disconnected",
      notice: "Voice disconnected. You can keep typing here.",
    });
    expect(t.connections).toEqual(["requesting_mic", "connecting", "connected", "reconnecting", "ended"]);
    expect(t.ends()).toHaveLength(1);
    expect(t.mints()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.connections.at(-1)).toBe("ended");
  });

  it("process restart without a delivered session.closed still ends after lost → ended", async () => {
    const answers: Array<() => Response> = [failing, failing, () => heartbeatJson("lost")];
    const t = setup({ heartbeat: (i) => (answers[i] ?? (() => heartbeatJson("ended")))() });
    await t.connect();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(t.session.snapshot()).toMatchObject({ connection: "ended", endReason: "disconnected" });
    expect(t.connections.slice(3)).toEqual(["reconnecting", "ended"]);
  });

  it("same runtime, sideband-only failure: degraded while re-attaching, then the same call resumes", async () => {
    const answers = ["healthy", "degraded", "degraded", "healthy"];
    const t = setup({ heartbeat: (i) => heartbeatJson(answers[i] ?? "healthy") });
    await t.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.session.snapshot().connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(4_000);

    expect(t.session.snapshot()).toMatchObject({ connection: "connected", phase: "listening" });
    expect(t.connections).toEqual(["requesting_mic", "connecting", "connected", "reconnecting", "connected"]);
    expect(t.track().enabled).toBe(true);
    expect(t.audio().muted).toBe(false);
    expect(t.peer().closed).toBe(false);
    expect(t.mints()).toBe(1);
    expect(t.ends()).toHaveLength(0);
  });
});

describe("visitor-safe end reasons", () => {
  it("collapses owner-only reasons and never exposes internals", () => {
    expect(visitorEndReason("heartbeat_lost")).toBe("disconnected");
    expect(visitorEndReason("control_lost")).toBe("disconnected");
    expect(visitorEndReason("usage_limit")).toBe("voice_unavailable");
    expect(visitorEndReason("sideband_lost")).toBeNull();
    for (const notice of Object.values(VOICE_END_NOTICES)) {
      expect(notice).not.toMatch(/sideband|provider|quota|plan|minute|billing|usage|runtime|recover/i);
    }
  });
});
