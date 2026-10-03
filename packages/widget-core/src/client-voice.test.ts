import { describe, expect, it, vi } from "vitest";

import { createFakeMedia, REAL_SDP_ANSWER, type FakeMedia } from "./__fixtures__/fake-media";
import { createWidgetController } from "./client";

type Call = { url: string; body: Record<string, unknown>; init?: RequestInit };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function sse(text: string, conversationId: string, messageId: string) {
  return new Response(
    `data: {"type":"token","text":${JSON.stringify(text)}}\n\ndata: {"type":"meta","messageId":"${messageId}","conversationId":"${conversationId}","sources":[],"confidence":0.9,"outcome":"answered_with_context"}\n\ndata: {"type":"done"}\n\n`,
  );
}

function setup(opts: {
  voiceEnabled?: boolean;
  media?: FakeMedia | null;
  mint?: { ephemeral: boolean; conversationId: string | null; transcriptSaved?: boolean; recording?: boolean };
  signing?: boolean;
  consentRequired?: boolean;
  endBody?: Record<string, unknown>;
  heartbeat?: () => Response;
} = {}) {
  const calls: Call[] = [];
  const storage = new Map<string, string>();
  const media = opts.media === undefined ? createFakeMedia() : opts.media;
  const mint = opts.mint ?? { ephemeral: false, conversationId: "conv_1" };
  const fetcher: typeof fetch = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, body: init?.body ? JSON.parse(String(init.body)) : {}, init });
    if (href.endsWith("/config")) {
      return Response.json({
        assistantId: "asst_pub",
        name: "Demo",
        welcomeMessage: "Welcome",
        settings: {},
        requireWidgetSigning: Boolean(opts.signing),
        voice: {
          enabled: opts.voiceEnabled ?? true,
          ...(opts.consentRequired !== undefined
            ? { recording: { consentRequired: opts.consentRequired } }
            : {}),
        },
      });
    }
    if (href.endsWith("/widget/sign")) return Response.json({ timestamp: 1, signature: "t=1,v1=abc" });
    if (href.endsWith("/api/v1/chat")) {
      const turn = calls.filter((call) => call.url.endsWith("/api/v1/chat")).length;
      return sse(`Answer ${turn}`, mint.conversationId ?? "conv_text", `m${turn}`);
    }
    if (href.endsWith("/api/v1/voice/sessions")) {
      return Response.json({
        sessionId: "vs_1",
        sdpAnswer: REAL_SDP_ANSWER,
        ...mint,
        ...(opts.heartbeat ? { controlToken: "ct_1", heartbeatIntervalMs: 5_000 } : {}),
      });
    }
    if (href.endsWith("/heartbeat") && opts.heartbeat) return opts.heartbeat();
    return Response.json(opts.endBody ?? { ended: true });
  };
  const controller = createWidgetController({
    assistantId: "asst_pub",
    apiUrl: "https://chat.example.com",
    fetch: fetcher,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    createId: () => "visitor_12345",
    voiceMedia: media,
  });
  const channel = () => media!.peers.at(-1)!.channel;
  const speak = () => {
    channel().receive({ type: "session.started" });
    channel().receive({ type: "session.input_transcript.delta", delta: "How many members did you say?", start_ms: 0, end_ms: 900 });
    channel().receive({ type: "session.output_transcript.delta", delta: "Zenith has 17 members.", start_ms: 1_500, end_ms: 3_000 });
  };
  return { controller, calls, storage, media, channel, speak };
}

describe("widget controller Voice", () => {
  it("text → Voice → text stays one conversation with shared history", async () => {
    const t = setup();
    await t.controller.load();
    await t.controller.send("Tell me about Zenith");

    await t.controller.startVoice();
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    expect(mint.body).toMatchObject({
      source: "widget",
      visitorId: "visitor_12345",
      conversationId: "conv_1",
      history: [
        { role: "user", content: "Tell me about Zenith" },
        { role: "assistant", content: "Answer 1" },
      ],
    });

    t.speak();
    const live = t.controller.getState().messages;
    expect(live.slice(2)).toEqual([
      expect.objectContaining({ role: "user", content: "How many members did you say?", modality: "voice" }),
      expect.objectContaining({ role: "assistant", content: "Zenith has 17 members.", modality: "voice", live: true }),
    ]);

    await t.controller.endVoice();
    expect(t.controller.getState().messages.some((message) => message.live)).toBe(false);
    expect(t.controller.getState().voice.connection).toBe("ended");

    await t.controller.send("Thanks");
    const chats = t.calls.filter((call) => call.url.endsWith("/api/v1/chat"));
    expect(chats[1]?.body).toMatchObject({
      message: "Thanks",
      conversationId: "conv_1",
      history: [
        { role: "user", content: "Tell me about Zenith" },
        { role: "assistant", content: "Answer 1" },
        { role: "user", content: "How many members did you say?" },
        { role: "assistant", content: "Zenith has 17 members." },
      ],
    });
    expect(t.controller.getState().messages.map((message) => message.content)).toEqual([
      "Tell me about Zenith",
      "Answer 1",
      "How many members did you say?",
      "Zenith has 17 members.",
      "Thanks",
      "Answer 2",
    ]);
  });

  it("Voice first: the durable conversation minted for Voice continues by text", async () => {
    const t = setup({ mint: { ephemeral: false, conversationId: "conv_voice" } });
    await t.controller.load();
    await t.controller.startVoice();
    t.speak();
    await t.controller.endVoice();

    expect(t.storage.get("chatai.widget.asst_pub.conversation")).toBe("conv_voice");
    await t.controller.send("And when was it founded?");
    const chat = t.calls.find((call) => call.url.endsWith("/api/v1/chat"))!;
    expect(chat.body).toMatchObject({ conversationId: "conv_voice" });
  });

  it("no-store: nothing is bound or stored, and Voice turns reach later text only as client history", async () => {
    const t = setup({ mint: { ephemeral: true, conversationId: null } });
    await t.controller.load();
    await t.controller.startVoice();
    expect(t.controller.getState().voice.ephemeral).toBe(true);
    t.speak();
    await t.controller.endVoice();

    expect(t.storage.has("chatai.widget.asst_pub.conversation")).toBe(false);
    await t.controller.send("Thanks");
    const chat = t.calls.find((call) => call.url.endsWith("/api/v1/chat"))!;
    expect(chat.body.conversationId).toBeUndefined();
    expect(chat.body.history).toEqual([
      { role: "user", content: "How many members did you say?" },
      { role: "assistant", content: "Zenith has 17 members." },
    ]);
  });

  it("transcripts off: Voice turns stay on screen but never become history after the session", async () => {
    const t = setup({ mint: { ephemeral: false, conversationId: "conv_1", transcriptSaved: false } });
    await t.controller.load();
    await t.controller.send("Tell me about Zenith");
    await t.controller.startVoice();
    expect(t.controller.getState().voice).toMatchObject({ ephemeral: false, transcriptSaved: false });
    t.speak();
    await t.controller.endVoice();

    const voiceTurns = t.controller.getState().messages.filter((message) => message.modality === "voice");
    expect(voiceTurns).toHaveLength(2);
    expect(voiceTurns.every((message) => message.unsaved)).toBe(true);

    await t.controller.send("Thanks");
    const chats = t.calls.filter((call) => call.url.endsWith("/api/v1/chat"));
    expect(chats[1]?.body.history).toEqual([
      { role: "user", content: "Tell me about Zenith" },
      { role: "assistant", content: "Answer 1" },
    ]);

    await t.controller.startVoice();
    const mints = t.calls.filter((call) => call.url.endsWith("/api/v1/voice/sessions"));
    expect(JSON.stringify(mints[1]?.body.history)).not.toContain("How many members did you say?");
    await t.controller.endVoice();
  });

  it("does not send text while Voice is live", async () => {
    const t = setup();
    await t.controller.load();
    await t.controller.startVoice();
    await t.controller.send("typed during voice");
    expect(t.calls.some((call) => call.url.endsWith("/api/v1/chat"))).toBe(false);
  });

  it("does nothing when the assistant does not offer public Voice", async () => {
    const t = setup({ voiceEnabled: false });
    await t.controller.load();
    await t.controller.startVoice();
    expect(t.controller.voiceAvailable()).toBe(false);
    expect(t.media!.micRequests).toBe(0);
    expect(t.calls.some((call) => call.url.includes("/voice/"))).toBe(false);
  });

  it("explains an unsupported browser instead of failing silently, and can be dismissed", async () => {
    const t = setup({ media: null });
    await t.controller.load();
    await t.controller.startVoice();
    expect(t.controller.getState().voice).toMatchObject({ connection: "failed", error: { code: "unsupported" } });
    t.controller.dismissVoiceError();
    expect(t.controller.getState().voice).toEqual({ connection: "idle", phase: "idle" });
  });

  it("reuses widget signing for mint and end", async () => {
    const t = setup({ signing: true });
    await t.controller.load();
    await t.controller.startVoice();
    await t.controller.endVoice();
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    const end = t.calls.find((call) => call.url.endsWith("/end"))!;
    expect((mint.init?.headers as Record<string, string>)["X-ChatAI-Signature"]).toBe("t=1,v1=abc");
    expect((end.init?.headers as Record<string, string>)["X-ChatAI-Signature"]).toBe("t=1,v1=abc");
  });

  it("a failed session can be retried and keeps the transcript so far", async () => {
    const t = setup();
    await t.controller.load();
    await t.controller.startVoice();
    t.speak();
    t.media!.peers[0]!.setConnectionState("failed");
    await flush();
    expect(t.controller.getState().voice.error?.code).toBe("media_failed");
    expect(t.controller.getState().messages).toHaveLength(2);

    await t.controller.startVoice();
    const mints = t.calls.filter((call) => call.url.endsWith("/api/v1/voice/sessions"));
    expect(mints).toHaveLength(2);
    expect(mints[1]?.body.history).toEqual([
      { role: "user", content: "How many members did you say?" },
      { role: "assistant", content: "Zenith has 17 members." },
    ]);
    await t.controller.endVoice();
  });

  it("destroy() releases the mic and ends the server session with keepalive", async () => {
    const t = setup();
    await t.controller.load();
    await t.controller.startVoice();
    t.controller.destroy();
    await flush();

    expect(t.media!.tracks[0]?.stopped).toBe(true);
    expect(t.media!.peers[0]?.closed).toBe(true);
    const end = t.calls.find((call) => call.url.endsWith("/end"))!;
    expect(end.init?.keepalive).toBe(true);
  });

  it("recorded sessions: disclosure first, no mic or session before Accept", async () => {
    const t = setup({ consentRequired: true, mint: { ephemeral: false, conversationId: "conv_1", recording: true } });
    await t.controller.load();
    expect(t.controller.voiceConsentRequired()).toBe(true);

    await t.controller.startVoice();
    expect(t.controller.getState().voice).toMatchObject({ connection: "idle", consentPending: true });
    expect(t.media!.micRequests).toBe(0);
    expect(t.calls.some((call) => call.url.endsWith("/api/v1/voice/sessions"))).toBe(false);

    await t.controller.acceptRecordingConsent();
    expect(t.media!.micRequests).toBe(1);
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    expect(mint.body.recordingConsent).toBe(true);
    expect(t.controller.getState().voice.consentPending).toBeUndefined();
    expect(t.controller.getState().voice.recording).toBe(true);
    await t.controller.endVoice();

    // Consent is per session: the next start shows the disclosure again.
    await t.controller.startVoice();
    expect(t.controller.getState().voice.consentPending).toBe(true);
  });

  it("Cancel on the disclosure returns to text chat with nothing requested", async () => {
    const t = setup({ consentRequired: true });
    await t.controller.load();
    await t.controller.startVoice();
    t.controller.declineRecordingConsent();
    expect(t.controller.getState().voice).toEqual({ connection: "idle", phase: "idle" });
    expect(t.media!.micRequests).toBe(0);
    expect(t.calls.some((call) => call.url.endsWith("/api/v1/voice/sessions"))).toBe(false);

    await t.controller.send("Typing instead");
    expect(t.controller.getState().messages.at(-1)?.content).toBe("Answer 1");
  });

  it("unrecorded sessions start directly and never send recordingConsent", async () => {
    const t = setup({ consentRequired: false });
    await t.controller.load();
    expect(t.controller.voiceConsentRequired()).toBe(false);
    await t.controller.startVoice();
    expect(t.media!.micRequests).toBe(1);
    const mint = t.calls.find((call) => call.url.endsWith("/api/v1/voice/sessions"))!;
    expect(mint.body).not.toHaveProperty("recordingConsent");
    expect(t.controller.getState().voice.recording).toBeUndefined();
    await t.controller.endVoice();
  });

  it("after Voice becomes unavailable, later text chats carry only a neutral flag", async () => {
    const t = setup({ endBody: { sessionId: "vs_1", status: "ended", endReason: "voice_unavailable" } });
    await t.controller.load();
    await t.controller.send("Hi");
    await t.controller.startVoice();
    t.speak();
    t.channel().receive({ type: "session.closed", reason: "close_requested" });
    await flush();
    await flush();

    expect(t.controller.getState().voice).toMatchObject({
      connection: "ended",
      notice: "Voice is unavailable for the rest of this conversation, but we can keep chatting here.",
    });
    await t.controller.send("Why did the voice end?");
    const chats = t.calls.filter((call) => call.url.endsWith("/api/v1/chat"));
    expect(chats[0]?.body.voiceUnavailable).toBeUndefined();
    expect(chats[1]?.body).toMatchObject({ message: "Why did the voice end?", voiceUnavailable: true });
    // Nothing about usage, quota or the account is sent or kept in widget state.
    const wire = JSON.stringify(chats.map((call) => call.body));
    expect(wire).not.toMatch(/usage_limit|quota|minute|plan|billing|remaining/i);
    expect(JSON.stringify(t.controller.getState())).not.toMatch(/usage_limit|quota|minute|billing|remaining/i);
    // No synthetic message is added to the visible conversation.
    expect(t.controller.getState().messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("text stays blocked while Voice reconnects and returns once control loss ends the call", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ heartbeat: () => Response.json({ error: "unavailable" }, { status: 503 }) });
      await t.controller.load();
      await t.controller.startVoice();
      t.speak();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(t.controller.getState().voice).toMatchObject({ connection: "reconnecting", phase: "reconnecting" });
      await t.controller.send("typed while reconnecting");
      expect(t.calls.some((call) => call.url.endsWith("/api/v1/chat"))).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(t.controller.getState().voice).toMatchObject({
        connection: "ended",
        notice: "Voice disconnected. You can keep typing here.",
      });
      expect(t.controller.getState().messages.some((message) => message.live)).toBe(false);
      await t.controller.send("Back to typing");
      const chat = t.calls.find((call) => call.url.endsWith("/api/v1/chat"))!;
      expect(chat.body).toMatchObject({ message: "Back to typing" });
      // Control loss is not Voice unavailability: the visitor may start Voice again themselves.
      expect(chat.body.voiceUnavailable).toBeUndefined();
      expect(t.calls.filter((call) => call.url.endsWith("/api/v1/voice/sessions"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a visitor-ended call does not set the Voice-unavailable flag", async () => {
    const t = setup();
    await t.controller.load();
    await t.controller.startVoice();
    t.speak();
    await t.controller.endVoice();
    await t.controller.send("Thanks");
    const chat = t.calls.find((call) => call.url.endsWith("/api/v1/chat"))!;
    expect(chat.body.voiceUnavailable).toBeUndefined();
  });
});
