import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { ControlAttachError, resolveVoiceSessionConfig, type VoiceControlEvent } from "../../types";
import { GptLiveRealtimeProvider } from "./gpt-live-realtime-provider";
import type { GptLiveSidebandChannel } from "./sideband-channel";
import type { VoiceWebSocket, VoiceWebSocketConnector } from "./websocket";
import { WS_OPEN } from "./websocket";

class FakeWebSocket extends EventEmitter implements VoiceWebSocket {
  readyState = 0;
  sent: string[] = [];
  pings = 0;
  terminated = false;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", 1000, Buffer.from(""));
  }

  ping(): void {
    this.pings += 1;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }

  /** Abnormal transport loss (no session.closed). */
  drop(code: number): void {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(""));
  }

  open(): void {
    this.readyState = WS_OPEN;
    this.emit("open");
  }

  pushServerJson(payload: unknown): void {
    this.emit("message", JSON.stringify(payload));
  }
}

function fakeConnector(bag: { sockets: FakeWebSocket[] }): VoiceWebSocketConnector {
  return () => {
    const ws = new FakeWebSocket();
    bag.sockets.push(ws);
    queueMicrotask(() => ws.open());
    return ws;
  };
}

describe("GptLiveRealtimeProvider", () => {
  it("exchanges SDP via POST /v1/live/sessions with server API key", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/live/sessions");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer sk-test-server-only");
      const body = JSON.parse(String(init?.body));
      expect(body.session.model).toBe("gpt-live-1");
      expect(body.session.delegation).toEqual({ type: "client" });
      // Security invariant: the browser data channel may not send any command.
      expect(body.session.client).toEqual({ data_channel: { allowed_client_events: [] } });
      expect(body.transport).toEqual({ type: "webrtc", sdp: "v=0\r\noffer" });
      return new Response(
        JSON.stringify({
          session: { id: "sess_live_1" },
          transport: { type: "webrtc", sdp: "v=0\r\nanswer" },
        }),
        { status: 200 },
      );
    });

    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test-server-only",
      fetch: fetchImpl as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });

    const created = await provider.createWebRtcSession({
      sdpOffer: "v=0\r\noffer",
      sessionConfig: resolveVoiceSessionConfig({}),
    });

    expect(created).toEqual({
      providerSessionId: "sess_live_1",
      sdpAnswer: "v=0\r\nanswer",
    });
    expect(JSON.stringify(created)).not.toContain("sk-test");
  });

  it("attaches sideband, maps delegation/usage, and finalizes close", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session: { id: "sess_live_2" },
          transport: { type: "webrtc", sdp: "answer" },
        }),
        { status: 200 },
      ),
    );
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: fetchImpl as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
      closeTimeoutMs: 200,
    });

    await provider.createWebRtcSession({
      sdpOffer: "offer",
      sessionConfig: resolveVoiceSessionConfig({}),
    });
    const channel = await provider.attachControlChannel("sess_live_2");
    expect(bag.sockets).toHaveLength(1);

    const events: string[] = [];
    const started: VoiceControlEvent[] = [];
    channel.subscribe((e) => {
      events.push(e.type);
      if (e.type === "session.started") started.push(e);
    });

    bag.sockets[0]!.pushServerJson({
      type: "session.started",
      session: { client: { data_channel: { allowed_client_events: [] } } },
    });
    expect(started).toEqual([
      { type: "session.started", providerSessionId: "sess_live_2", browserCommandsBlocked: true },
    ]);
    bag.sockets[0]!.pushServerJson({
      type: "session.delegation.created",
      offset_ms: 10,
      delegation: { id: "d1", type: "delegation", target: "client" },
    });
    bag.sockets[0]!.pushServerJson({
      type: "session.usage.updated",
      usage: { seconds: 12 },
    });

    expect(events).toContain("session.started");
    expect(events).toContain("delegation.created");
    expect(events).toContain("usage.updated");

    const appendOk = await channel.appendCommentary("d1", "Hello from RAG");
    expect(appendOk).toMatchObject({ ok: true, eventId: expect.any(String) });
    expect(bag.sockets[0]!.sent.some((s) => s.includes("session.commentary.append"))).toBe(
      true,
    );

    const acks: unknown[] = [];
    channel.subscribe((e) => {
      if (e.type === "append.acknowledged") acks.push(e);
    });
    bag.sockets[0]!.pushServerJson({
      type: "session.commentary.appended",
      client_event_id: appendOk.ok ? appendOk.eventId : "",
      start_ms: 900,
      end_ms: 950,
    });
    expect(acks).toEqual([
      {
        type: "append.acknowledged",
        kind: "commentary",
        clientEventId: appendOk.ok ? appendOk.eventId : null,
        startMs: 900,
        endMs: 950,
      },
    ]);

    const closePromise = channel.close("close_requested");
    queueMicrotask(() => {
      bag.sockets[0]!.pushServerJson({
        type: "session.closed",
        reason: "close_requested",
        usage: { seconds: 18 },
      });
    });
    const closed = await closePromise;
    expect(closed).toEqual({
      ok: true,
      reason: "close_requested",
      usageSeconds: 18,
    });
  });

  it("routes reflected audio to audio subscribers only, never the control event bus", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ session: { id: "sess_audio" }, transport: { type: "webrtc", sdp: "a" } }),
        { status: 200 },
      ),
    );
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: fetchImpl as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });
    await provider.createWebRtcSession({ sdpOffer: "o", sessionConfig: resolveVoiceSessionConfig({}) });
    const channel = await provider.attachControlChannel("sess_audio");
    const events: string[] = [];
    channel.subscribe((e) => events.push(e.type));

    const pcm = new Int16Array([1, -2, 32767, -32768]);
    const b64 = Buffer.from(pcm.buffer).toString("base64");
    // No audio subscriber yet: frames are dropped without decoding.
    bag.sockets[0]!.pushServerJson({ type: "session.input_audio.append", audio: b64 });

    const frames: Array<{ source: string; pcm: number[]; startMs?: number | null }> = [];
    const unsubscribe = channel.subscribeAudio!((f) =>
      frames.push({
        source: f.source,
        pcm: [...f.pcm],
        ...(f.source === "output" ? { startMs: f.startMs } : {}),
      }),
    );
    bag.sockets[0]!.pushServerJson({ type: "session.input_audio.append", audio: b64 });
    bag.sockets[0]!.pushServerJson({
      type: "session.output_audio.delta",
      delta: b64,
      start_ms: 1200,
      end_ms: 1300,
    });
    unsubscribe();
    bag.sockets[0]!.pushServerJson({ type: "session.input_audio.append", audio: b64 });

    expect(frames).toEqual([
      { source: "input", pcm: [1, -2, 32767, -32768] },
      { source: "output", pcm: [1, -2, 32767, -32768], startMs: 1200 },
    ]);
    expect(events).toEqual([]);
  });

  it("seeds startup history as session.input within the documented budget", async () => {
    let body: { session: { input?: unknown[] } } | null = null;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ session: { id: "s" }, transport: { type: "webrtc", sdp: "a" } }),
        { status: 201 },
      );
    });
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: fetchImpl as unknown as typeof fetch,
    });
    await provider.createWebRtcSession({
      sdpOffer: "offer",
      sessionConfig: {
        ...resolveVoiceSessionConfig({}),
        history: [
          { role: "user", text: "What is the Pro plan?" },
          { role: "assistant", text: "Pro has 5 seats. [1]" },
          { role: "user", text: "   " },
        ],
      },
    });
    expect(body!.session.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "What is the Pro plan?" }] },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Pro has 5 seats. [1]" }] },
    ]);

    const long = Array.from({ length: 300 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      text: `turn ${i} ${"x".repeat(400)}`,
    }));
    await provider.createWebRtcSession({
      sdpOffer: "offer",
      sessionConfig: { ...resolveVoiceSessionConfig({}), history: long },
    });
    const input = body!.session.input as Array<{ content: Array<{ text: string }> }>;
    const total = input.reduce((sum, m) => sum + m.content[0]!.text.length, 0);
    expect(input.length).toBeLessThanOrEqual(128);
    expect(total).toBeLessThanOrEqual(24_000);
    // Keeps the most recent turns.
    expect(input.at(-1)!.content[0]!.text.startsWith("turn 299")).toBe(true);
  });

  it("rejects create when provider returns error status", async () => {
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector({ sockets: [] }),
    });

    await expect(
      provider.createWebRtcSession({
        sdpOffer: "offer",
        sessionConfig: resolveVoiceSessionConfig({}),
      }),
    ).rejects.toThrow(/401/);
  });

  it("a socket drop before session.closed is a retriable control disconnect, not a session end", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });
    const channel = await provider.attachControlChannel("sess_drop");
    const events: VoiceControlEvent[] = [];
    channel.subscribe((e) => events.push(e));

    bag.sockets[0]!.drop(1006);
    expect(events).toEqual([{ type: "control.disconnected", cause: "closed", closeCode: 1006 }]);
    expect(channel.isConnected!()).toBe(false);
    expect(await channel.appendInstructions("hello")).toMatchObject({
      ok: false,
      reason: "provider_error",
    });
  });

  it("re-attaches in place and never re-delivers replayed control events", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });
    const channel = await provider.attachControlChannel("sess_re");
    const events: VoiceControlEvent[] = [];
    channel.subscribe((e) => events.push(e));

    const started = { type: "session.started", event_id: "ev_1" };
    const delegation = {
      type: "session.delegation.created",
      event_id: "ev_2",
      offset_ms: 900,
      delegation: { id: "del_1", type: "delegation", target: "client" },
    };
    const transcript = {
      type: "session.input_transcript.delta",
      event_id: "ev_3",
      delta: "What are your hours?",
      start_ms: 100,
      end_ms: 800,
    };
    bag.sockets[0]!.pushServerJson(started);
    bag.sockets[0]!.pushServerJson(transcript);
    bag.sockets[0]!.pushServerJson(delegation);
    bag.sockets[0]!.drop(1006);

    // Same channel object comes back; a new socket is opened.
    const again = await provider.attachControlChannel("sess_re");
    expect(again).toBe(channel);
    expect(bag.sockets).toHaveLength(2);

    // The provider replays its backlog on every attach.
    bag.sockets[1]!.pushServerJson(started);
    bag.sockets[1]!.pushServerJson(transcript);
    bag.sockets[1]!.pushServerJson(delegation);
    bag.sockets[1]!.pushServerJson({
      type: "session.input_transcript.delta",
      event_id: "ev_4",
      delta: "Thanks",
      start_ms: 3000,
      end_ms: 3300,
    });

    expect(events.map((e) => e.type)).toEqual([
      "session.started",
      "transcript.input.delta",
      "delegation.created",
      "control.disconnected",
      "control.reattached",
      "transcript.input.delta",
    ]);
    expect(events.filter((e) => e.type === "delegation.created")).toHaveLength(1);
    expect((channel as GptLiveSidebandChannel).getDuplicatesDropped()).toBe(3);
    // Delegation state survived: the surviving id still accepts its answer.
    expect(await channel.appendCommentary("del_1", "We open at nine.")).toMatchObject({ ok: true });
    expect(bag.sockets[1]!.sent.some((s) => s.includes("session.commentary.append"))).toBe(true);
  });

  it("a replayed delegation without an event id never re-activates", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });
    const channel = (await provider.attachControlChannel("sess_noid")) as GptLiveSidebandChannel;
    const created: string[] = [];
    channel.subscribe((e) => {
      if (e.type === "delegation.created") created.push(e.delegationId);
    });
    const d1 = {
      type: "session.delegation.created",
      offset_ms: 1,
      delegation: { id: "d1", type: "delegation", target: "client" },
    };
    bag.sockets[0]!.pushServerJson(d1);
    bag.sockets[0]!.pushServerJson({
      type: "session.delegation.created",
      offset_ms: 2,
      delegation: { id: "d2", type: "delegation", target: "client" },
    });
    bag.sockets[0]!.pushServerJson(d1);

    expect(created).toEqual(["d1", "d2"]);
    expect(channel.delegations.get("d1")?.status).toBe("superseded");
    expect(channel.delegations.get("d2")?.status).toBe("active");
  });

  it("dedupes replayed reflected audio after a re-attach", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });
    const channel = await provider.attachControlChannel("sess_audio_re");
    const frames: string[] = [];
    channel.subscribeAudio!((f) => frames.push(f.source === "output" ? `out:${f.startMs}` : `in:${f.pcm[0]}`));
    const pcm = (value: number) => Buffer.from(new Int16Array([value, value]).buffer).toString("base64");

    bag.sockets[0]!.pushServerJson({ type: "session.input_audio.append", audio: pcm(1) });
    bag.sockets[0]!.pushServerJson({ type: "session.output_audio.delta", delta: pcm(9), start_ms: 100, end_ms: 120 });
    bag.sockets[0]!.drop(1006);
    await channel.reattach!();
    bag.sockets[1]!.pushServerJson({ type: "session.input_audio.append", audio: pcm(1) });
    bag.sockets[1]!.pushServerJson({ type: "session.output_audio.delta", delta: pcm(9), start_ms: 100, end_ms: 120 });
    bag.sockets[1]!.pushServerJson({ type: "session.input_audio.append", audio: pcm(2) });
    bag.sockets[1]!.pushServerJson({ type: "session.output_audio.delta", delta: pcm(9), start_ms: 120, end_ms: 140 });

    expect(frames).toEqual(["in:1", "out:100", "in:2", "out:120"]);
  });

  it("re-attach to an ended provider session fails as session gone", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    let refuse = false;
    const connector: VoiceWebSocketConnector = () => {
      const ws = new FakeWebSocket();
      bag.sockets.push(ws);
      queueMicrotask(() => {
        if (refuse) ws.emit("error", new Error("Unexpected server response: 404"));
        else ws.open();
      });
      return ws;
    };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: connector,
    });
    const channel = await provider.attachControlChannel("sess_gone");
    bag.sockets[0]!.drop(1006);
    refuse = true;

    const error = await channel.reattach!().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ControlAttachError);
    expect((error as ControlAttachError).sessionGone).toBe(true);
    expect(channel.isConnected!()).toBe(false);
  });

  it("detects a silent sideband via ping/pong liveness", async () => {
    vi.useFakeTimers();
    try {
      const bag = { sockets: [] as FakeWebSocket[] };
      const provider = new GptLiveRealtimeProvider({
        apiKey: "sk-test",
        fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
        connectWebSocket: fakeConnector(bag),
        pingIntervalMs: 1_000,
        livenessTimeoutMs: 3_000,
      });
      const attaching = provider.attachControlChannel("sess_live");
      await vi.advanceTimersByTimeAsync(0);
      const channel = await attaching;
      const events: VoiceControlEvent[] = [];
      channel.subscribe((e) => events.push(e));

      // Pongs keep it alive.
      for (let i = 0; i < 5; i += 1) {
        await vi.advanceTimersByTimeAsync(1_000);
        bag.sockets[0]!.emit("pong");
      }
      expect(bag.sockets[0]!.pings).toBeGreaterThanOrEqual(4);
      expect(events).toEqual([]);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(events).toEqual([
        { type: "control.disconnected", cause: "liveness_timeout", closeCode: null },
      ]);
      expect(bag.sockets[0]!.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("hangs up over HTTP without a sideband", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let status = 200;
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (status === 0) throw new Error("network down");
        return new Response(status === 200 ? "{}" : '{"error":{"code":"session_id_not_found"}}', { status });
      }) as unknown as typeof fetch,
    });

    expect(await provider.hangupSession("sess_h")).toEqual({ ok: true });
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/live/sessions/sess_h/hangup");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBeUndefined();
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");

    status = 404;
    expect(await provider.hangupSession("sess_h")).toEqual({ ok: false, reason: "not_found", status: 404 });
    status = 500;
    expect(await provider.hangupSession("sess_h")).toEqual({ ok: false, reason: "provider_error", status: 500 });
    status = 0;
    expect(await provider.hangupSession("sess_h")).toEqual({ ok: false, reason: "provider_error" });
  });

  it("gates appends with DelegationTracker (superseded vs completed)", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
    });
    const channel = await provider.attachControlChannel("sess_gate");
    const ws = bag.sockets[0]!;
    ws.pushServerJson({
      type: "session.delegation.created",
      offset_ms: 1,
      delegation: { id: "d1", type: "delegation", target: "client" },
    });
    ws.pushServerJson({
      type: "session.delegation.created",
      offset_ms: 2,
      delegation: { id: "d2", type: "delegation", target: "client" },
    });

    expect(await channel.appendCommentary("d1", "late")).toEqual({
      ok: false,
      reason: "superseded",
    });
    expect(await channel.appendCommentary("unknown", "x")).toEqual({
      ok: false,
      reason: "unknown_delegation",
    });
    expect(await channel.appendCommentary("d2", "fresh")).toMatchObject({ ok: true });
  });

  it("sends session-wide commentary with a null delegation id, bypassing the delegation gate", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
      closeTimeoutMs: 20,
    });
    const channel = await provider.attachControlChannel("sess_null");
    const ws = bag.sockets[0]!;

    expect(await channel.appendCommentary(null, "I can only help with orders.")).toMatchObject({ ok: true });
    const sent = ws.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    expect(sent.find((command) => command.type === "session.commentary.append")).toMatchObject({
      delegation_id: null,
      content: "I can only help with orders.",
    });
    expect(await channel.appendCommentary(null, "   ")).toMatchObject({ ok: false, reason: "invalid_content" });

    await channel.close();
    expect(await channel.appendCommentary(null, "late")).toEqual({ ok: false, reason: "session_closed" });
  });

  it("reports incomplete usage finalization when sideband dies early", async () => {
    const bag = { sockets: [] as FakeWebSocket[] };
    const provider = new GptLiveRealtimeProvider({
      apiKey: "sk-test",
      fetch: (async () =>
        new Response(
          JSON.stringify({
            session: { id: "sess_x" },
            transport: { type: "webrtc", sdp: "a" },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
      connectWebSocket: fakeConnector(bag),
      closeTimeoutMs: 50,
    });

    const channel = await provider.attachControlChannel("sess_x");
    bag.sockets[0]!.pushServerJson({
      type: "session.usage.updated",
      usage: { seconds: 5 },
    });

    const result = await channel.close("close_requested");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.usageFinalized).toBe(false);
      expect(result.usageSeconds).toBe(5);
    }
  });
});
