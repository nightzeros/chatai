import { createHash, randomUUID } from "node:crypto";

import { DelegationTracker } from "../../delegation-tracker";
import {
  ControlAttachError,
  type AppendResult,
  type ControlDisconnectCause,
  type ReflectedAudioFrame,
  type SessionCloseReason,
  type SessionCloseResult,
  type VoiceControlChannel,
  type VoiceControlEvent,
} from "../../types";
import {
  mapGptLiveWireEventToAudioFrame,
  mapGptLiveWireEventToControlEvent,
  type GptLiveClientCommand,
  type GptLiveWireEvent,
} from "./types";
import {
  createWsConnector,
  WS_OPEN,
  type VoiceWebSocket,
  type VoiceWebSocketConnector,
} from "./websocket";

const DEFAULT_CLOSE_TIMEOUT_MS = 8_000;
const DEFAULT_PING_INTERVAL_MS = 5_000;
const DEFAULT_LIVENESS_TIMEOUT_MS = 15_000;
/** Control event ids remembered for replay dedupe (a session emits far fewer per backlog). */
const SEEN_EVENT_LIMIT = 4_096;
/** Output deltas remembered for replay dedupe (~20 s of assistant audio). */
const SEEN_OUTPUT_AUDIO_LIMIT = 1_024;
/** Input frames remembered for replay dedupe (~10 s of visitor audio). */
const RECENT_INPUT_AUDIO_LIMIT = 512;
/** After a re-attach, repeated input frames arriving this soon are treated as replay. */
const REPLAY_AUDIO_WINDOW_MS = 5_000;

export type GptLiveSidebandOptions = {
  providerSessionId: string;
  apiKey: string;
  /** Origin like https://api.openai.com (no /v1 suffix required). */
  apiOrigin: string;
  connectWebSocket?: VoiceWebSocketConnector;
  closeTimeoutMs?: number;
  /** Transport ping cadence; any inbound frame also proves liveness. */
  pingIntervalMs?: number;
  /** No inbound frame or pong for this long means the sideband is dead. */
  livenessTimeoutMs?: number;
  /** Shared tracker so ChatAI orchestration and the channel agree on supersession. */
  delegations?: DelegationTracker;
  now?: () => number;
};

function toMessageString(data: string | Buffer | ArrayBuffer | Buffer[]): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function attachUrl(apiOrigin: string, providerSessionId: string): string {
  const base = apiOrigin.replace(/\/$/, "");
  const httpBase = base.endsWith("/v1") ? base.slice(0, -3) : base;
  const wsBase = httpBase.replace(/^http/, "ws");
  return `${wsBase}/v1/live/sessions/${encodeURIComponent(providerSessionId)}/attach`;
}

function toAttachError(err: unknown): ControlAttachError {
  if (err instanceof ControlAttachError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const status = /Unexpected server response: (\d{3})/.exec(message)?.[1];
  return new ControlAttachError(message, status ? Number(status) : null);
}

/** Insertion-ordered set that forgets its oldest entries past `limit`. */
class BoundedSet {
  private readonly items = new Set<string>();
  constructor(private readonly limit: number) {}

  has(value: string): boolean {
    return this.items.has(value);
  }

  add(value: string): void {
    this.items.add(value);
    if (this.items.size > this.limit) {
      const oldest = this.items.values().next().value;
      if (oldest !== undefined) this.items.delete(oldest);
    }
  }
}

/**
 * GPT-Live sideband control channel (Topology B).
 * Receives lifecycle/transcript/delegation/usage events; sends append/close commands.
 * Does not carry primary WebRTC media.
 *
 * A transport drop before `session.closed` is not the end of the session: the
 * channel emits `control.disconnected` and can `reattach()` in place. The provider
 * replays a short backlog on every attach, so control events are deduplicated by
 * their stable `event_id` and replayed audio by content; a replayed delegation is
 * never delivered twice.
 */
export class GptLiveSidebandChannel implements VoiceControlChannel {
  readonly providerSessionId: string;
  readonly delegations: DelegationTracker;

  private readonly listeners = new Set<(event: VoiceControlEvent) => void>();
  private readonly audioListeners = new Set<(frame: ReflectedAudioFrame) => void>();
  private readonly closeTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly livenessTimeoutMs: number;
  private readonly connectWebSocket: VoiceWebSocketConnector;
  private readonly apiKey: string;
  private readonly apiOrigin: string;
  private readonly now: () => number;

  private ws: VoiceWebSocket | null = null;
  private connected = false;
  private attachPromise: Promise<void> | null = null;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private lastInboundAt = 0;
  private disconnectedAt: number | null = null;
  private replayUntil = 0;
  private closed = false;
  private usageSeconds = 0;
  private usageFinalized = false;
  private closeWaiters: Array<(result: SessionCloseResult) => void> = [];
  private seq = 0;
  private duplicatesDropped = 0;
  private readonly seenEventIds = new BoundedSet(SEEN_EVENT_LIMIT);
  private readonly seenOutputAudio = new BoundedSet(SEEN_OUTPUT_AUDIO_LIMIT);
  private readonly recentInputAudio = new BoundedSet(RECENT_INPUT_AUDIO_LIMIT);

  constructor(options: GptLiveSidebandOptions) {
    this.providerSessionId = options.providerSessionId;
    this.apiKey = options.apiKey;
    this.apiOrigin = options.apiOrigin;
    this.connectWebSocket = options.connectWebSocket ?? createWsConnector();
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.livenessTimeoutMs = options.livenessTimeoutMs ?? DEFAULT_LIVENESS_TIMEOUT_MS;
    this.delegations = options.delegations ?? new DelegationTracker();
    this.now = options.now ?? Date.now;
  }

  /** Open the sideband WebSocket. Idempotent. Rejects with `ControlAttachError`. */
  async attach(): Promise<void> {
    if (this.ws && this.connected) return;
    if (this.attachPromise) return this.attachPromise;

    this.attachPromise = new Promise<void>((resolve, reject) => {
      const url = attachUrl(this.apiOrigin, this.providerSessionId);
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        this.cleanupSocket();
        reject(toAttachError(err));
      };

      try {
        const ws = this.connectWebSocket(url, {
          Authorization: `Bearer ${this.apiKey}`,
        });
        this.ws = ws;

        ws.once("open", () => {
          if (settled) return;
          settled = true;
          this.connected = true;
          this.lastInboundAt = this.now();
          if (this.disconnectedAt !== null) this.replayUntil = this.now() + REPLAY_AUDIO_WINDOW_MS;
          this.startLiveness(ws);
          resolve();
        });
        ws.on("message", (data) => {
          if (this.ws !== ws) return;
          this.lastInboundAt = this.now();
          this.onMessage(toMessageString(data));
        });
        ws.on("pong", () => {
          if (this.ws === ws) this.lastInboundAt = this.now();
        });
        ws.on("error", (err) => {
          if (!settled) {
            fail(err);
            return;
          }
          this.emit({
            type: "error",
            code: "sideband_error",
            message: err.message,
            retriable: true,
          });
        });
        ws.on("close", (code) => {
          if (!settled) {
            fail(new ControlAttachError(`Sideband closed during attach (${code})`));
            return;
          }
          if (this.ws === ws) this.onTransportLost("closed", code);
        });
      } catch (err) {
        fail(err);
      }
    }).finally(() => {
      this.attachPromise = null;
    });

    return this.attachPromise;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Re-open the sideband after `control.disconnected`. Listeners, the delegation
   * tracker and replay dedupe survive; `control.reattached` reports the gap.
   */
  async reattach(): Promise<void> {
    if (this.usageFinalized || this.closed) {
      throw new ControlAttachError("Sideband control channel is closed.");
    }
    if (this.connected) return;
    const lostAt = this.disconnectedAt ?? this.now();
    this.disconnectedAt = lostAt;
    await this.attach();
    this.disconnectedAt = null;
    this.emit({ type: "control.reattached", gapMs: Math.max(0, this.now() - lostAt) });
  }

  subscribe(listener: (event: VoiceControlEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeAudio(listener: (frame: ReflectedAudioFrame) => void): () => void {
    this.audioListeners.add(listener);
    return () => this.audioListeners.delete(listener);
  }

  async appendCommentary(delegationId: string | null, content: string): Promise<AppendResult> {
    if (delegationId !== null) {
      return this.appendDelegated("session.commentary.append", delegationId, content);
    }
    if (this.closed) return { ok: false, reason: "session_closed" };
    if (!content.trim()) return { ok: false, reason: "invalid_content" };
    return this.sendCommand({
      type: "session.commentary.append",
      event_id: this.nextEventId(),
      delegation_id: null,
      content,
    });
  }

  async appendThinking(delegationId: string, content: string): Promise<AppendResult> {
    return this.appendDelegated("session.thinking.append", delegationId, content);
  }

  async appendInstructions(
    content: string,
    delegationId?: string | null,
  ): Promise<AppendResult> {
    if (this.closed) return { ok: false, reason: "session_closed" };
    if (!content.trim()) return { ok: false, reason: "invalid_content" };
    if (delegationId) {
      const gate = this.delegations.acceptAppend(delegationId);
      if (!gate.ok) return { ok: false, reason: gate.reason };
    }
    return this.sendCommand({
      type: "session.instructions.append",
      event_id: this.nextEventId(),
      delegation_id: delegationId ?? null,
      content,
    });
  }

  async close(reason: SessionCloseReason = "close_requested"): Promise<SessionCloseResult> {
    if (this.closed && this.usageFinalized) {
      return {
        ok: false,
        reason: "already_closed",
        usageSeconds: this.usageSeconds,
        usageFinalized: true,
      };
    }
    void reason;

    this.closed = true;
    this.delegations.closeSession();

    const waitClosed = new Promise<SessionCloseResult>((resolve) => {
      this.closeWaiters.push(resolve);
    });

    const sendResult = await this.sendCommand({
      type: "session.close",
      event_id: this.nextEventId(),
    });

    if (!sendResult.ok && sendResult.reason === "provider_error") {
      return this.finishClose({
        ok: false,
        reason: "provider_error",
        message: sendResult.message,
        usageSeconds: this.usageSeconds,
        usageFinalized: false,
      });
    }

    const timeout = new Promise<SessionCloseResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve(
          this.finishClose({
            ok: false,
            reason: "provider_error",
            message: "Timed out waiting for session.closed",
            usageSeconds: this.usageSeconds,
            usageFinalized: false,
          }),
        );
      }, this.closeTimeoutMs);
      timer.unref?.();
    });

    return Promise.race([waitClosed, timeout]);
  }

  /** Latest known usage seconds (may be unconfirmed until session.closed). */
  getUsageSeconds(): number {
    return this.usageSeconds;
  }

  isUsageFinalized(): boolean {
    return this.usageFinalized;
  }

  /** Replayed events and audio frames dropped so far (diagnostics and tests). */
  getDuplicatesDropped(): number {
    return this.duplicatesDropped;
  }

  private async appendDelegated(
    type: "session.commentary.append" | "session.thinking.append",
    delegationId: string,
    content: string,
  ): Promise<AppendResult> {
    if (this.closed) return { ok: false, reason: "session_closed" };
    if (!content.trim()) return { ok: false, reason: "invalid_content" };
    const gate = this.delegations.acceptAppend(delegationId);
    if (!gate.ok) return { ok: false, reason: gate.reason };
    return this.sendCommand({
      type,
      event_id: this.nextEventId(),
      delegation_id: delegationId,
      content,
    });
  }

  private async sendCommand(command: GptLiveClientCommand): Promise<AppendResult> {
    if (!this.ws || !this.connected || this.ws.readyState !== WS_OPEN) {
      return { ok: false, reason: "provider_error", message: "Sideband not connected" };
    }
    try {
      this.ws.send(JSON.stringify(command));
      return { ok: true, eventId: command.event_id };
    } catch (err) {
      return {
        ok: false,
        reason: "provider_error",
        message: err instanceof Error ? err.message : "send failed",
      };
    }
  }

  private onMessage(raw: string): void {
    let wire: GptLiveWireEvent;
    try {
      wire = JSON.parse(raw) as GptLiveWireEvent;
    } catch {
      this.emit({
        type: "error",
        code: "invalid_json",
        message: "Sideband received non-JSON frame",
      });
      return;
    }

    if (wire.type === "session.input_audio.append" || wire.type === "session.output_audio.delta") {
      if (this.audioListeners.size === 0) return;
      if (this.isReplayedAudio(wire)) {
        this.duplicatesDropped += 1;
        return;
      }
      const frame = mapGptLiveWireEventToAudioFrame(wire);
      if (frame) this.emitAudio(frame);
      return;
    }

    if (wire.event_id) {
      if (this.seenEventIds.has(wire.event_id)) {
        this.duplicatesDropped += 1;
        return;
      }
      this.seenEventIds.add(wire.event_id);
    }

    if (wire.type === "session.delegation.created") {
      // Second guard for replays without a stable id: a known delegation never re-activates.
      if (this.delegations.get(wire.delegation.id)) {
        this.duplicatesDropped += 1;
        return;
      }
      if (this.delegations.isSessionOpen()) {
        this.delegations.supersedeAllActive(wire.offset_ms);
        this.delegations.create(wire.delegation.id, wire.offset_ms);
      }
    }

    if (wire.type === "session.usage.updated") {
      this.usageSeconds = wire.usage.seconds;
    }

    const mapped = mapGptLiveWireEventToControlEvent(this.providerSessionId, wire);
    if (mapped) {
      if (mapped.type === "usage.updated") {
        this.usageSeconds = mapped.seconds;
      }
      if (mapped.type === "session.closed") {
        this.usageSeconds = mapped.usageSeconds;
        this.usageFinalized = true;
        this.closed = true;
        this.delegations.closeSession();
        this.emit(mapped);
        this.finishClose({
          ok: true,
          reason: mapped.reason,
          usageSeconds: mapped.usageSeconds,
        });
        return;
      }
      this.emit(mapped);
    }
  }

  /**
   * Output deltas carry session-timeline stamps, so an exact repeat is a replay.
   * Input frames carry no id or stamp: a repeat is only treated as replay shortly
   * after a re-attach, when the provider flushes its backlog.
   */
  private isReplayedAudio(
    wire: Extract<GptLiveWireEvent, { type: "session.input_audio.append" | "session.output_audio.delta" }>,
  ): boolean {
    if (wire.type === "session.output_audio.delta") {
      if (typeof wire.delta !== "string") return false;
      const key = `${wire.start_ms ?? ""}:${wire.end_ms ?? ""}:${wire.delta.length}`;
      if (this.seenOutputAudio.has(key)) return true;
      this.seenOutputAudio.add(key);
      return false;
    }
    if (typeof wire.audio !== "string") return false;
    const digest = createHash("sha1").update(wire.audio).digest("base64");
    const replay = this.now() < this.replayUntil && this.recentInputAudio.has(digest);
    this.recentInputAudio.add(digest);
    return replay;
  }

  private emit(event: VoiceControlEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not tear down the sideband.
      }
    }
  }

  private emitAudio(frame: ReflectedAudioFrame): void {
    for (const listener of this.audioListeners) {
      try {
        listener(frame);
      } catch {
        // Recording is best-effort; it must never tear down the sideband.
      }
    }
  }

  private onTransportLost(cause: ControlDisconnectCause, closeCode: number | null): void {
    this.cleanupSocket(cause === "liveness_timeout");
    if (this.usageFinalized) return;
    if (this.closed) {
      // A close was in flight: usage is unconfirmed.
      this.finishClose({
        ok: false,
        reason: "provider_error",
        message: "Sideband closed before session.closed",
        usageSeconds: this.usageSeconds,
        usageFinalized: false,
      });
      return;
    }
    this.disconnectedAt = this.now();
    this.emit({ type: "control.disconnected", cause, closeCode });
  }

  private startLiveness(ws: VoiceWebSocket): void {
    this.stopLiveness();
    const timer = setInterval(() => {
      if (this.ws !== ws || !this.connected) return;
      if (this.now() - this.lastInboundAt >= this.livenessTimeoutMs) {
        this.onTransportLost("liveness_timeout", null);
        return;
      }
      try {
        ws.ping?.();
      } catch {
        // A failing ping surfaces as a close or a liveness timeout.
      }
    }, this.pingIntervalMs);
    timer.unref?.();
    this.livenessTimer = timer;
  }

  private stopLiveness(): void {
    if (!this.livenessTimer) return;
    clearInterval(this.livenessTimer);
    this.livenessTimer = null;
  }

  private finishClose(result: SessionCloseResult): SessionCloseResult {
    const waiters = this.closeWaiters;
    this.closeWaiters = [];
    for (const resolve of waiters) resolve(result);
    this.cleanupSocket();
    return result;
  }

  private cleanupSocket(terminate = false): void {
    this.stopLiveness();
    this.connected = false;
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    try {
      ws.removeAllListeners();
      // A late socket error must never become an unhandled 'error' event.
      ws.on("error", () => undefined);
      if (terminate && ws.terminate) ws.terminate();
      else ws.close();
    } catch {
      // ignore
    }
  }

  private nextEventId(): string {
    this.seq += 1;
    return `chatai_${this.seq}_${randomUUID().slice(0, 8)}`;
  }
}
