import {
  resolveVoiceSessionConfig,
  type CreateWebRtcSessionInput,
  type ProviderHangupResult,
  type RealtimeVoiceProvider,
  type VoiceControlChannel,
  type WebRtcSessionCreateResult,
} from "../../types";
import { GptLiveSidebandChannel } from "./sideband-channel";
import {
  GPT_LIVE_DEFAULTS,
  GPT_LIVE_PROVIDER_ID,
  buildGptLiveCreateRequest,
  type GptLiveCreateResponse,
} from "./types";
import { createWsConnector, type VoiceWebSocketConnector } from "./websocket";

export type GptLiveRealtimeProviderOptions = {
  /** Server-side OpenAI project API key — never expose to browsers. */
  apiKey: string;
  /**
   * API base URL. Accepts `https://api.openai.com` or `https://api.openai.com/v1`.
   * Defaults to OpenAI public API.
   */
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  connectWebSocket?: VoiceWebSocketConnector;
  closeTimeoutMs?: number;
  pingIntervalMs?: number;
  livenessTimeoutMs?: number;
  hangupTimeoutMs?: number;
};

const DEFAULT_HANGUP_TIMEOUT_MS = 5_000;

function normalizeOrigin(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function sessionsUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${GPT_LIVE_DEFAULTS.sessionsPath}`;
}

/**
 * Real GPT-Live adapter (Topology B).
 * - createWebRtcSession: server-side POST /v1/live/sessions SDP exchange
 * - attachControlChannel: sideband WSS attach for events/commands
 * Permanent credentials stay on the server; browsers only receive SDP answers.
 */
export class GptLiveRealtimeProvider implements RealtimeVoiceProvider {
  readonly id = GPT_LIVE_PROVIDER_ID;

  private readonly apiKey: string;
  private readonly apiOrigin: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly connectWebSocket: VoiceWebSocketConnector;
  private readonly closeTimeoutMs?: number;
  private readonly pingIntervalMs?: number;
  private readonly livenessTimeoutMs?: number;
  private readonly hangupTimeoutMs: number;
  private readonly channels = new Map<string, GptLiveSidebandChannel>();

  constructor(options: GptLiveRealtimeProviderOptions) {
    if (!options.apiKey?.trim()) {
      throw new Error("GptLiveRealtimeProvider requires a server-side apiKey.");
    }
    this.apiKey = options.apiKey;
    this.apiOrigin = normalizeOrigin(options.baseUrl ?? "https://api.openai.com");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.connectWebSocket = options.connectWebSocket ?? createWsConnector();
    this.closeTimeoutMs = options.closeTimeoutMs;
    this.pingIntervalMs = options.pingIntervalMs;
    this.livenessTimeoutMs = options.livenessTimeoutMs;
    this.hangupTimeoutMs = options.hangupTimeoutMs ?? DEFAULT_HANGUP_TIMEOUT_MS;
  }

  async createWebRtcSession(
    input: CreateWebRtcSessionInput,
  ): Promise<WebRtcSessionCreateResult> {
    const config = resolveVoiceSessionConfig(input.sessionConfig);
    if (config.delegationMode !== "client") {
      throw new Error(
        "GptLiveRealtimeProvider only supports client delegation (V1 production architecture).",
      );
    }
    if (!input.sdpOffer.trim()) {
      throw new Error("sdpOffer is required.");
    }

    const body = buildGptLiveCreateRequest({
      sdpOffer: input.sdpOffer,
      model: config.model,
      voice: config.voice,
      instructions: config.instructions,
      history: config.history,
    });

    const response = await this.fetchImpl(sessionsUrl(this.apiOrigin), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await safeErrorText(response);
      throw new Error(
        `GPT-Live session create failed (${response.status}): ${detail || response.statusText}`,
      );
    }

    const json = (await response.json()) as GptLiveCreateResponse;
    const providerSessionId = json.session?.id;
    const sdpAnswer = json.transport?.sdp;
    if (!providerSessionId || typeof sdpAnswer !== "string" || !sdpAnswer.trim()) {
      throw new Error("GPT-Live session create returned an incomplete response.");
    }

    return { providerSessionId, sdpAnswer };
  }

  /**
   * Attach (or re-attach) the sideband. A disconnected cached channel is re-opened
   * in place so its listeners, delegations and replay dedupe survive; a finalized
   * one is replaced.
   */
  async attachControlChannel(providerSessionId: string): Promise<VoiceControlChannel> {
    const existing = this.channels.get(providerSessionId);
    if (existing && !existing.isUsageFinalized()) {
      if (!existing.isConnected()) await existing.reattach();
      return existing;
    }

    const channel = new GptLiveSidebandChannel({
      providerSessionId,
      apiKey: this.apiKey,
      apiOrigin: this.apiOrigin,
      connectWebSocket: this.connectWebSocket,
      closeTimeoutMs: this.closeTimeoutMs,
      pingIntervalMs: this.pingIntervalMs,
      livenessTimeoutMs: this.livenessTimeoutMs,
    });
    await channel.attach();
    this.channels.set(providerSessionId, channel);
    return channel;
  }

  /**
   * `POST /v1/live/sessions/{id}/hangup`: ends the provider session without a
   * sideband. An attached sideband then receives `session.closed` with final usage.
   */
  async hangupSession(providerSessionId: string): Promise<ProviderHangupResult> {
    const url = `${sessionsUrl(this.apiOrigin)}/${encodeURIComponent(providerSessionId)}/hangup`;
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.hangupTimeoutMs),
      });
      if (response.ok) return { ok: true };
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        reason: response.status === 404 ? "not_found" : "provider_error",
        status: response.status,
      };
    } catch {
      return { ok: false, reason: "provider_error" };
    }
  }
}

async function safeErrorText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 400);
  } catch {
    return "";
  }
}
