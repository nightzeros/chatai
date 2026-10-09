import { DelegationTracker } from "../delegation-tracker";
import {
  ControlAttachError,
  REFLECTED_AUDIO_SAMPLE_RATE,
  type AppendRejectReason,
  type AppendResult,
  type ControlDisconnectCause,
  type CreateWebRtcSessionInput,
  type ProviderHangupResult,
  type RealtimeVoiceProvider,
  type ReflectedAudioFrame,
  type SessionCloseReason,
  type SessionCloseResult,
  type VoiceControlChannel,
  type VoiceControlEvent,
  type WebRtcSessionCreateResult,
} from "../types";

export type MockVoiceScenarioHooks = {
  /** Fail createWebRtcSession with this message. */
  failCreateWith?: string;
  /** Fail attachControlChannel with this message. */
  failAttachWith?: string;
  /** session.started does not confirm the browser command lock (provider ignored it). */
  browserCommandsUnlocked?: boolean;
  /** Re-attach attempts fail: "refuse" transiently, "gone" as an ended session (404). */
  reattach?: "ok" | "refuse" | "gone";
  /** hangupSession fails with a provider error. */
  failHangup?: boolean;
  /** hangupSession succeeds but the sideband never delivers `session.closed`. */
  withholdClosedEvent?: boolean;
  /**
   * Like GPT-Live: `session.started` arrives on the next tick after attach, whether
   * or not anyone has subscribed yet (default: emitted on the first subscribe).
   */
  startedAfterAttach?: boolean;
};

type MockSession = {
  providerSessionId: string;
  sdpAnswer: string;
  correlationId?: string;
  model: string;
  voice: string;
  closed: boolean;
  /** Sideband transport open (false after simulateSidebandDrop until re-attach). */
  connected: boolean;
  disconnectedAt: number | null;
  startedEmitted: boolean;
  usageSeconds: number;
  timelineMs: number;
  seqInternal: number;
  delegations: DelegationTracker;
  listeners: Set<(event: VoiceControlEvent) => void>;
  audioListeners: Set<(frame: ReflectedAudioFrame) => void>;
  channel?: MockControlChannel;
};

/**
 * In-process realtime provider for contract tests and Phase 1 CI.
 * Simulates Topology B control semantics without network or credentials.
 */
export class MockRealtimeVoiceProvider implements RealtimeVoiceProvider {
  readonly id = "mock" as const;
  private readonly sessions = new Map<string, MockSession>();
  private seq = 0;

  constructor(readonly hooks: MockVoiceScenarioHooks = {}) {}

  /** Hangup attempts, in order (tests assert server-authoritative endings). */
  readonly hangups: string[] = [];

  async createWebRtcSession(
    input: CreateWebRtcSessionInput,
  ): Promise<WebRtcSessionCreateResult> {
    if (this.hooks.failCreateWith) {
      throw new Error(this.hooks.failCreateWith);
    }
    if (input.sessionConfig.delegationMode !== "client") {
      throw new Error(
        "MockRealtimeVoiceProvider only supports client delegation (V1 production architecture).",
      );
    }
    if (!input.sdpOffer.trim()) {
      throw new Error("sdpOffer is required.");
    }

    this.seq += 1;
    const providerSessionId = `mock_sess_${this.seq}`;
    const sdpAnswer = buildMockSdpAnswer(providerSessionId);

    this.sessions.set(providerSessionId, {
      providerSessionId,
      sdpAnswer,
      correlationId: input.correlationId,
      model: input.sessionConfig.model,
      voice: input.sessionConfig.voice,
      closed: false,
      connected: true,
      disconnectedAt: null,
      startedEmitted: false,
      usageSeconds: 0,
      timelineMs: 0,
      seqInternal: 0,
      delegations: new DelegationTracker(),
      listeners: new Set(),
      audioListeners: new Set(),
    });

    return { providerSessionId, sdpAnswer };
  }

  async attachControlChannel(providerSessionId: string): Promise<VoiceControlChannel> {
    if (this.hooks.failAttachWith) {
      throw new Error(this.hooks.failAttachWith);
    }
    const session = this.sessions.get(providerSessionId);
    if (!session) {
      throw new Error(`Unknown provider session: ${providerSessionId}`);
    }
    if (session.closed) {
      throw new ControlAttachError(`Session already closed: ${providerSessionId}`, 404);
    }
    if (session.channel) {
      if (!session.connected) await session.channel.reattach();
      return session.channel;
    }

    const channel = new MockControlChannel(session, this.hooks);
    session.channel = channel;
    if (this.hooks.startedAfterAttach) setTimeout(() => channel.emitStarted(), 0);
    return channel;
  }

  async hangupSession(providerSessionId: string): Promise<ProviderHangupResult> {
    this.hangups.push(providerSessionId);
    if (this.hooks.failHangup) return { ok: false, reason: "provider_error", status: 500 };
    const session = this.sessions.get(providerSessionId);
    if (!session || session.closed) return { ok: false, reason: "not_found", status: 404 };
    session.delegations.closeSession();
    session.closed = true;
    if (this.hooks.withholdClosedEvent) return { ok: true };
    // Like GPT-Live: only a connected sideband observes the final usage.
    session.channel?.emit({
      type: "session.closed",
      reason: "close_requested",
      usageSeconds: session.usageSeconds,
    });
    return { ok: true };
  }

  /** Test helper: locate an attached channel. */
  getChannel(providerSessionId: string): MockControlChannel | undefined {
    return this.sessions.get(providerSessionId)?.channel;
  }
}

export class MockControlChannel implements VoiceControlChannel {
  constructor(
    private readonly session: MockSession,
    private readonly hooks: MockVoiceScenarioHooks = {},
  ) {}

  get providerSessionId(): string {
    return this.session.providerSessionId;
  }

  subscribe(listener: (event: VoiceControlEvent) => void): () => void {
    this.session.listeners.add(listener);
    // Emit to all listeners including the new one.
    if (!this.hooks.startedAfterAttach) this.emitStarted();
    return () => this.session.listeners.delete(listener);
  }

  /** Delivers `session.started` once, to whoever is subscribed right now. */
  emitStarted(): void {
    if (this.session.startedEmitted || this.session.closed) return;
    this.session.startedEmitted = true;
    this.emit({
      type: "session.started",
      providerSessionId: this.session.providerSessionId,
      browserCommandsBlocked: !this.hooks.browserCommandsUnlocked,
    });
  }

  /** Delivers to listeners; like a real sideband, nothing but control notices arrives while disconnected. */
  emit(event: VoiceControlEvent): void {
    if (!this.session.connected && !event.type.startsWith("control.")) return;
    for (const listener of [...this.session.listeners]) {
      listener(event);
    }
  }

  isConnected(): boolean {
    return this.session.connected && !this.session.closed;
  }

  /** Fault injection: the sideband transport drops while the provider session lives on. */
  simulateSidebandDrop(cause: ControlDisconnectCause = "closed", closeCode: number | null = 1006): void {
    if (!this.session.connected || this.session.closed) return;
    this.session.connected = false;
    this.session.disconnectedAt = Date.now();
    this.emit({ type: "control.disconnected", cause, closeCode });
  }

  /** Fault injection: the provider session ends while no sideband is attached. */
  simulateProviderEndedWhileDetached(): void {
    this.session.delegations.closeSession();
    this.session.closed = true;
  }

  async reattach(): Promise<void> {
    if (this.session.closed || this.hooks.reattach === "gone") {
      throw new ControlAttachError("Unexpected server response: 404", 404);
    }
    if (this.hooks.reattach === "refuse") {
      throw new ControlAttachError("Unexpected server response: 503", 503);
    }
    if (this.session.connected) return;
    const lostAt = this.session.disconnectedAt ?? Date.now();
    this.session.connected = true;
    this.session.disconnectedAt = null;
    this.emit({ type: "control.reattached", gapMs: Math.max(0, Date.now() - lostAt) });
  }

  advanceTimeline(ms: number): void {
    this.session.timelineMs += Math.max(0, ms);
  }

  setUsageSeconds(seconds: number): void {
    this.session.usageSeconds = Math.max(0, seconds);
    this.emit({ type: "usage.updated", seconds: this.session.usageSeconds });
  }

  /** Simulate user speech transcript fragments. */
  simulateInputTranscript(text: string, durationMs = 400): void {
    this.assertOpen();
    const startMs = this.session.timelineMs;
    this.advanceTimeline(durationMs);
    this.emit({
      type: "transcript.input.delta",
      text,
      startMs,
      endMs: this.session.timelineMs,
    });
  }

  /** Simulate assistant speech transcript fragments. */
  simulateOutputTranscript(text: string, durationMs = 400): void {
    this.assertOpen();
    const startMs = this.session.timelineMs;
    this.advanceTimeline(durationMs);
    this.emit({
      type: "transcript.output.delta",
      text,
      startMs,
      endMs: this.session.timelineMs,
    });
  }

  /**
   * Simulate GPT-Live client delegation.
   * Returns the new active delegation id.
   */
  simulateDelegationCreated(delegationId?: string): string {
    this.assertOpen();
    this.session.seqInternal += 1;
    const id = delegationId ?? `mock_del_${this.session.seqInternal}`;
    this.session.delegations.create(id, this.session.timelineMs);
    this.emit({
      type: "delegation.created",
      delegationId: id,
      offsetMs: this.session.timelineMs,
    });
    return id;
  }

  simulateAssistantOutputStarted(delegationId?: string): void {
    this.assertOpen();
    this.emit({ type: "assistant.output.started", delegationId });
  }

  /**
   * Barge-in: supersede active delegations, emit interrupted, reject late appends.
   */
  simulateInterruption(): string[] {
    this.assertOpen();
    const superseded = this.session.delegations.supersedeAllActive(this.session.timelineMs);
    this.emit({ type: "assistant.interrupted", atMs: this.session.timelineMs });
    return superseded;
  }

  /** Explicitly supersede one delegation without a full interrupt event. */
  supersedeDelegation(delegationId: string): boolean {
    this.assertOpen();
    return this.session.delegations.supersede(delegationId, this.session.timelineMs);
  }

  subscribeAudio(listener: (frame: ReflectedAudioFrame) => void): () => void {
    this.session.audioListeners.add(listener);
    return () => this.session.audioListeners.delete(listener);
  }

  /** Reflected visitor microphone audio (24 kHz mono PCM16, no timestamps). */
  simulateInputAudio(pcm: Int16Array): void {
    this.emitAudio({ source: "input", pcm });
  }

  /** Reflected assistant audio placed on the session timeline. */
  simulateOutputAudio(pcm: Int16Array, startMs: number): void {
    const endMs = startMs + Math.round((pcm.length / REFLECTED_AUDIO_SAMPLE_RATE) * 1000);
    this.emitAudio({ source: "output", pcm, startMs, endMs });
  }

  private emitAudio(frame: ReflectedAudioFrame): void {
    for (const listener of [...this.session.audioListeners]) {
      try {
        listener(frame);
      } catch {
        // Mirrors the sideband: audio listener errors never affect the session.
      }
    }
  }

  simulateProviderError(code: string, message: string, retriable = false): void {
    this.emit({ type: "error", code, message, retriable });
  }

  /** Session-wide commentary appended without a delegation (server-forced turns). */
  readonly undelegatedCommentary: string[] = [];

  async appendCommentary(delegationId: string | null, content: string): Promise<AppendResult> {
    if (delegationId !== null) return this.append(delegationId, content);
    if (!content.trim()) {
      return { ok: false, reason: "invalid_content", message: "content is empty" };
    }
    if (this.session.closed || !this.session.delegations.isSessionOpen()) {
      return { ok: false, reason: "session_closed" };
    }
    if (!this.session.connected) {
      return { ok: false, reason: "provider_error", message: "Sideband not connected" };
    }
    this.undelegatedCommentary.push(content);
    this.simulateAssistantOutputStarted();
    return { ok: true };
  }

  async appendThinking(delegationId: string, content: string): Promise<AppendResult> {
    return this.append(delegationId, content, { complete: false });
  }

  async appendInstructions(
    content: string,
    delegationId: string | null = null,
  ): Promise<AppendResult> {
    if (!content.trim()) {
      return { ok: false, reason: "invalid_content", message: "content is empty" };
    }
    if (this.session.closed || !this.session.delegations.isSessionOpen()) {
      return { ok: false, reason: "session_closed" };
    }
    if (!this.session.connected) {
      return { ok: false, reason: "provider_error", message: "Sideband not connected" };
    }
    if (delegationId != null) {
      const gate = this.session.delegations.acceptAppend(delegationId);
      if (!gate.ok) {
        return { ok: false, reason: mapGateReason(gate.reason) };
      }
    }
    return { ok: true };
  }

  async close(reason: SessionCloseReason = "close_requested"): Promise<SessionCloseResult> {
    if (this.session.closed) {
      return {
        ok: false,
        reason: "already_closed",
        usageSeconds: this.session.usageSeconds,
        usageFinalized: true,
      };
    }
    if (!this.session.connected) {
      return {
        ok: false,
        reason: "provider_error",
        message: "Sideband not connected",
        usageSeconds: this.session.usageSeconds,
        usageFinalized: false,
      };
    }
    this.session.delegations.closeSession();
    this.session.closed = true;
    this.emit({
      type: "session.closed",
      reason,
      usageSeconds: this.session.usageSeconds,
    });
    return { ok: true, reason, usageSeconds: this.session.usageSeconds };
  }

  private append(
    delegationId: string,
    content: string,
    options: { complete?: boolean } = {},
  ): AppendResult {
    if (!content.trim()) {
      return { ok: false, reason: "invalid_content", message: "content is empty" };
    }
    if (!this.session.connected && !this.session.closed) {
      return { ok: false, reason: "provider_error", message: "Sideband not connected" };
    }
    const gate = this.session.delegations.acceptAppend(delegationId);
    if (!gate.ok) {
      return { ok: false, reason: mapGateReason(gate.reason) };
    }
    if (options.complete !== false) {
      this.session.delegations.complete(delegationId, this.session.timelineMs);
      this.simulateAssistantOutputStarted(delegationId);
    }
    return { ok: true };
  }

  private assertOpen(): void {
    if (this.session.closed) {
      throw new Error("Session is closed.");
    }
  }
}

function mapGateReason(
  reason: "superseded" | "unknown_delegation" | "completed" | "session_closed",
): AppendRejectReason {
  return reason;
}

function buildMockSdpAnswer(providerSessionId: string): string {
  return [
    "v=0",
    `o=- 0 0 IN IP4 127.0.0.1`,
    "s=ChatAI Mock Realtime",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS *",
    `a=chatai-mock-session:${providerSessionId}`,
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "c=IN IP4 0.0.0.0",
    "a=rtcp:9 IN IP4 0.0.0.0",
    "a=ice-ufrag:mock",
    "a=ice-pwd:mockpasswordmockpassword",
    "a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
    "a=setup:active",
    "a=mid:0",
    "a=sendrecv",
    "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2",
  ].join("\r\n");
}
