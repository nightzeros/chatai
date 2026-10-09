import { describe, expect, it } from "vitest";

import { DelegationTracker } from "./delegation-tracker";
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
  resolveVoiceSessionConfig,
} from "./index";
import { MockRealtimeVoiceProvider } from "./mock";
import {
  GPT_LIVE_DEFAULTS,
  buildGptLiveCreateRequest,
  isBrowserCommandLockConfirmed,
  mapGptLiveWireEventToControlEvent,
} from "./providers/gpt-live";
import { ControlAttachError, type RealtimeVoiceProvider, type VoiceControlEvent } from "./types";

function collectEvents(channel: {
  subscribe: (listener: (event: VoiceControlEvent) => void) => () => void;
}): VoiceControlEvent[] {
  const events: VoiceControlEvent[] = [];
  channel.subscribe((event) => events.push(event));
  return events;
}

const minimalOffer = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";

describe("resolveVoiceSessionConfig", () => {
  it("applies configurable defaults without scattering literals at call sites", () => {
    expect(resolveVoiceSessionConfig()).toEqual({
      model: DEFAULT_VOICE_MODEL,
      voice: DEFAULT_VOICE_ID,
      instructions: "Be concise and helpful.",
      delegationMode: "client",
    });
    expect(DEFAULT_VOICE_MODEL).toBe("gpt-live-1");
    expect(DEFAULT_VOICE_ID).toBe("marin");
  });

  it("allows overriding model and voice via configuration", () => {
    expect(
      resolveVoiceSessionConfig({
        model: "custom-live",
        voice: "alloy",
        instructions: "Stay brief.",
      }),
    ).toMatchObject({
      model: "custom-live",
      voice: "alloy",
      instructions: "Stay brief.",
      delegationMode: "client",
    });
  });
});

describe("RealtimeVoiceProvider contract (mock)", () => {
  it("implements the provider-neutral interface", async () => {
    const provider: RealtimeVoiceProvider = new MockRealtimeVoiceProvider();
    expect(provider.id).toBe("mock");

    const created = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
      correlationId: "corr_1",
    });

    expect(created.providerSessionId).toMatch(/^mock_sess_/);
    expect(created.sdpAnswer).toContain("a=chatai-mock-session:");
    expect(created.sdpAnswer).toContain("m=audio");

    const channel = await provider.attachControlChannel(created.providerSessionId);
    expect(channel.providerSessionId).toBe(created.providerSessionId);

    const events = collectEvents(channel);
    expect(events.some((e) => e.type === "session.started")).toBe(true);
  });

  it("rejects empty SDP offers and non-client delegation modes", async () => {
    const provider = new MockRealtimeVoiceProvider();
    await expect(
      provider.createWebRtcSession({
        sdpOffer: "   ",
        sessionConfig: resolveVoiceSessionConfig(),
      }),
    ).rejects.toThrow(/sdpOffer/i);

    await expect(
      provider.createWebRtcSession({
        sdpOffer: minimalOffer,
        sessionConfig: {
          ...resolveVoiceSessionConfig(),
          delegationMode: "responses" as unknown as "client",
        },
      }),
    ).rejects.toThrow(/client delegation/i);
  });

  it("simulates transcript, usage, and clean close", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await provider.attachControlChannel(providerSessionId);
    const channel = provider.getChannel(providerSessionId);
    expect(channel).toBeDefined();
    const events = collectEvents(channel!);

    channel!.simulateInputTranscript("What is ChatAI?");
    channel!.setUsageSeconds(3);
    channel!.simulateOutputTranscript("ChatAI is an open-source assistant platform.");
    channel!.setUsageSeconds(8);

    const closed = await channel!.close();
    expect(closed).toEqual({
      ok: true,
      reason: "close_requested",
      usageSeconds: 8,
    });

    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        "transcript.input.delta",
        "usage.updated",
        "transcript.output.delta",
        "session.closed",
      ]),
    );

    const late = await channel!.appendCommentary("missing", "too late");
    expect(late).toEqual({ ok: false, reason: "session_closed" });

    const secondClose = await channel!.close();
    expect(secondClose.ok).toBe(false);
  });

  it("surfaces provider create/attach errors", async () => {
    const failCreate = new MockRealtimeVoiceProvider({
      failCreateWith: "upstream unavailable",
    });
    await expect(
      failCreate.createWebRtcSession({
        sdpOffer: minimalOffer,
        sessionConfig: resolveVoiceSessionConfig(),
      }),
    ).rejects.toThrow(/upstream unavailable/);

    const provider = new MockRealtimeVoiceProvider({
      failAttachWith: "sideband denied",
    });
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await expect(provider.attachControlChannel(providerSessionId)).rejects.toThrow(
      /sideband denied/,
    );
  });

  it("emits provider error events without closing the session", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await provider.attachControlChannel(providerSessionId);
    const channel = provider.getChannel(providerSessionId)!;
    const events = collectEvents(channel);

    channel.simulateProviderError("rate_limit", "Too many sessions", true);
    expect(events).toContainEqual({
      type: "error",
      code: "rate_limit",
      message: "Too many sessions",
      retriable: true,
    });

    const closed = await channel.close();
    expect(closed.ok).toBe(true);
  });
});

describe("delegation race: interrupt / supersede / late reject", () => {
  it("rejects late commentary after interruption supersedes the active delegation", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await provider.attachControlChannel(providerSessionId);
    const channel = provider.getChannel(providerSessionId)!;
    const events = collectEvents(channel);

    channel.simulateInputTranscript("Explain managed hosting.");
    const del1 = channel.simulateDelegationCreated();

    // Slow RAG result is in flight…
    const superseded = channel.simulateInterruption();
    expect(superseded).toEqual([del1]);
    expect(events.some((e) => e.type === "assistant.interrupted")).toBe(true);

    const late = await channel.appendCommentary(
      del1,
      "Managed hosting means NightZeros runs the infra.",
    );
    expect(late).toEqual({ ok: false, reason: "superseded" });

    // New turn after barge-in.
    channel.simulateInputTranscript("Wait — what does managed mean?");
    const del2 = channel.simulateDelegationCreated();
    const ok = await channel.appendCommentary(
      del2,
      "Managed means we operate Postgres, updates, and monitoring for you.",
    );
    expect(ok).toEqual({ ok: true });
    expect(events.some((e) => e.type === "assistant.output.started")).toBe(true);
  });

  it("rejects appends for unknown and completed delegations", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await provider.attachControlChannel(providerSessionId);
    const channel = provider.getChannel(providerSessionId)!;

    expect(await channel.appendThinking("nope", "fact")).toEqual({
      ok: false,
      reason: "unknown_delegation",
    });

    const del = channel.simulateDelegationCreated();
    expect(await channel.appendCommentary(del, "First answer.")).toEqual({ ok: true });
    // Completed → distinct from superseded (interruption / newer turn).
    expect(await channel.appendCommentary(del, "Second answer.")).toEqual({
      ok: false,
      reason: "completed",
    });
  });

  it("accepts session-wide (null delegation) commentary without touching active delegations", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await provider.attachControlChannel(providerSessionId);
    const channel = provider.getChannel(providerSessionId)!;

    const del = channel.simulateDelegationCreated();
    expect(await channel.appendCommentary(null, "Server answer.")).toEqual({ ok: true });
    expect(channel.undelegatedCommentary).toEqual(["Server answer."]);
    expect(await channel.appendCommentary(null, " ")).toMatchObject({ ok: false, reason: "invalid_content" });
    // The open delegation is unaffected and still accepts its own result.
    expect(await channel.appendCommentary(del, "Delegated answer.")).toEqual({ ok: true });

    await channel.close();
    expect(await channel.appendCommentary(null, "late")).toEqual({ ok: false, reason: "session_closed" });
  });

  it("allows thinking appends without completing the delegation, then still supersedes on interrupt", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    await provider.attachControlChannel(providerSessionId);
    const channel = provider.getChannel(providerSessionId)!;

    const del = channel.simulateDelegationCreated();
    expect(await channel.appendThinking(del, "Retrieved 3 chunks.")).toEqual({ ok: true });
    channel.simulateInterruption();
    expect(await channel.appendCommentary(del, "Spoken answer")).toEqual({
      ok: false,
      reason: "superseded",
    });
  });

  it("confirms the browser command lock at session.started unless the scenario says otherwise", async () => {
    for (const unlocked of [false, true]) {
      const provider = new MockRealtimeVoiceProvider({ browserCommandsUnlocked: unlocked });
      const { providerSessionId } = await provider.createWebRtcSession({
        sdpOffer: minimalOffer,
        sessionConfig: resolveVoiceSessionConfig(),
      });
      const events = collectEvents(await provider.attachControlChannel(providerSessionId));
      expect(events[0]).toEqual({
        type: "session.started",
        providerSessionId,
        browserCommandsBlocked: !unlocked,
      });
    }
  });

  it("models sideband loss, re-attach and server hangup like the real adapter", async () => {
    const provider = new MockRealtimeVoiceProvider();
    const { providerSessionId } = await provider.createWebRtcSession({
      sdpOffer: minimalOffer,
      sessionConfig: resolveVoiceSessionConfig(),
    });
    const channel = await provider.attachControlChannel(providerSessionId);
    const events = collectEvents(channel);
    const mock = provider.getChannel(providerSessionId)!;
    const del = mock.simulateDelegationCreated();

    mock.simulateSidebandDrop();
    expect(channel.isConnected!()).toBe(false);
    // Nothing but control notices crosses a dead sideband.
    mock.setUsageSeconds(9);
    expect(await channel.appendCommentary(del, "late")).toMatchObject({ ok: false, reason: "provider_error" });
    expect(await channel.close()).toMatchObject({ ok: false, usageFinalized: false });

    expect(await provider.attachControlChannel(providerSessionId)).toBe(channel);
    expect(channel.isConnected!()).toBe(true);
    expect(await channel.appendCommentary(del, "answer")).toEqual({ ok: true });

    mock.setUsageSeconds(21);
    expect(await provider.hangupSession(providerSessionId)).toEqual({ ok: true });
    expect(await provider.hangupSession(providerSessionId)).toMatchObject({ ok: false, reason: "not_found" });
    expect(events.map((e) => e.type)).toEqual([
      "session.started",
      "delegation.created",
      "control.disconnected",
      "control.reattached",
      "assistant.output.started",
      "usage.updated",
      "session.closed",
    ]);
    expect(events.at(-1)).toEqual({ type: "session.closed", reason: "close_requested", usageSeconds: 21 });
    await expect(provider.attachControlChannel(providerSessionId)).rejects.toMatchObject({ sessionGone: true });
  });

  it("fault-injects refused and gone re-attach", async () => {
    for (const [mode, gone] of [["refuse", false], ["gone", true]] as const) {
      const provider = new MockRealtimeVoiceProvider({ reattach: mode });
      const { providerSessionId } = await provider.createWebRtcSession({
        sdpOffer: minimalOffer,
        sessionConfig: resolveVoiceSessionConfig(),
      });
      const channel = await provider.attachControlChannel(providerSessionId);
      provider.getChannel(providerSessionId)!.simulateSidebandDrop();
      const error = await channel.reattach!().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ControlAttachError);
      expect((error as ControlAttachError).sessionGone).toBe(gone);
    }
  });

  it("DelegationTracker supersedeAllActive is race-safe for concurrent active ids", () => {
    const tracker = new DelegationTracker();
    tracker.create("a");
    tracker.create("b");
    expect(tracker.supersedeAllActive(10)).toEqual(["a", "b"]);
    expect(tracker.acceptAppend("a")).toEqual({ ok: false, reason: "superseded" });
    expect(tracker.acceptAppend("b")).toEqual({ ok: false, reason: "superseded" });
  });
});

describe("GPT-Live adapter types (no network)", () => {
  it("builds a client-delegation-only create request from config", () => {
    const request = buildGptLiveCreateRequest({
      sdpOffer: minimalOffer,
      model: GPT_LIVE_DEFAULTS.model,
      voice: GPT_LIVE_DEFAULTS.voice,
      instructions: "Delegate knowledge questions to the backend.",
    });

    expect(request.session.delegation).toEqual({ type: "client" });
    expect(request.session.model).toBe("gpt-live-1");
    expect(request.session.audio?.output?.voice).toBe("marin");
    expect(request.transport).toEqual({ type: "webrtc", sdp: minimalOffer });
    expect(request).not.toHaveProperty("session.delegation.responses");
  });

  it("always locks the browser data channel, whatever the config (security invariant)", () => {
    const request = buildGptLiveCreateRequest({
      sdpOffer: minimalOffer,
      model: "custom-live",
      voice: "alloy",
      instructions: "x",
      history: [{ role: "user", text: "hi" }],
    });
    expect(request.session.client).toEqual({ data_channel: { allowed_client_events: [] } });
  });

  it("confirms the lock only from an echoed empty allowlist", () => {
    const echoed = (client: unknown) =>
      mapGptLiveWireEventToControlEvent("sess_1", { type: "session.started", session: { client } });

    expect(echoed({ data_channel: { allowed_client_events: [] } })).toEqual({
      type: "session.started",
      providerSessionId: "sess_1",
      browserCommandsBlocked: true,
    });
    for (const unconfirmed of [
      undefined,
      null,
      {},
      { data_channel: {} },
      { data_channel: { allowed_client_events: null } },
      { data_channel: { allowed_client_events: ["session.close"] } },
      { data_channel: { allowed_client_events: "none" } },
    ]) {
      expect(echoed(unconfirmed)).toMatchObject({ browserCommandsBlocked: false });
    }
    expect(isBrowserCommandLockConfirmed(undefined)).toBe(false);
  });

  it("maps wire events to provider-neutral control events", () => {
    expect(
      mapGptLiveWireEventToControlEvent("sess_1", { type: "session.started" }),
    ).toEqual({ type: "session.started", providerSessionId: "sess_1", browserCommandsBlocked: false });

    expect(
      mapGptLiveWireEventToControlEvent("sess_1", {
        type: "session.delegation.created",
        offset_ms: 1200,
        delegation: { id: "item_abc", type: "delegation", target: "client" },
      }),
    ).toEqual({
      type: "delegation.created",
      delegationId: "item_abc",
      offsetMs: 1200,
    });

    expect(
      mapGptLiveWireEventToControlEvent("sess_1", {
        type: "session.input_audio.append",
        audio: "AAAA",
      }),
    ).toBeNull();
  });
});
