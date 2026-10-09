/**
 * GPT-Live vendor event shapes and config — isolated from core contracts.
 * Phase 1: types + mappers only. No network I/O, no OpenAI SDK dependency.
 */

import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
} from "../../defaults";
import type {
  ReflectedAudioFrame,
  SessionCloseReason,
  VoiceControlEvent,
  VoiceHistoryMessage,
} from "../../types";

/** Configurable defaults for the gpt-live adapter (not scattered literals). */
export const GPT_LIVE_PROVIDER_ID = "gpt-live" as const;

export const GPT_LIVE_DEFAULTS = {
  model: DEFAULT_VOICE_MODEL,
  voice: DEFAULT_VOICE_ID,
  /** Data channel label expected by GPT-Live WebRTC clients. */
  dataChannelLabel: "oai-events",
  /** Sideband attach path template (relative to API host). */
  sidebandPathTemplate: "/v1/live/sessions/{session_id}/attach",
  /** Session create path. */
  sessionsPath: "/v1/live/sessions",
} as const;

/** Client-delegation-only session config fragment for Live create. */
export type GptLiveClientDelegation = {
  type: "client";
};

/**
 * Minimal Live session object ChatAI will send on create (client delegation only).
 * Responses delegation is intentionally omitted from V1 production types.
 */
export type GptLiveInputMessage = {
  type: "message";
  role: "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
};

export type GptLiveSessionCreateBody = {
  model: string;
  instructions: string;
  /** Startup text history (≤128 messages, ≤8,192 combined tokens). */
  input?: GptLiveInputMessage[];
  audio?: {
    output?: {
      voice?: string;
    };
  };
  delegation: GptLiveClientDelegation;
  /**
   * Browser data-channel command policy. ChatAI always sends an empty allowlist
   * (security invariant): the browser receives server events but never steers
   * the provider session. The field is undocumented upstream, so the session is
   * only trusted once `session.started` echoes it back.
   */
  client: GptLiveClientPolicy;
};

export type GptLiveClientPolicy = {
  data_channel: { allowed_client_events: string[] };
};

/** True only when the provider echoed an empty browser-command allowlist. */
export function isBrowserCommandLockConfirmed(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  const client = (session as { client?: unknown }).client;
  if (!client || typeof client !== "object") return false;
  const channel = (client as { data_channel?: unknown }).data_channel;
  if (!channel || typeof channel !== "object") return false;
  const allowed = (channel as { allowed_client_events?: unknown }).allowed_client_events;
  return Array.isArray(allowed) && allowed.length === 0;
}

export type GptLiveWebRtcTransport = {
  type: "webrtc";
  sdp: string;
};

export type GptLiveCreateRequest = {
  session: GptLiveSessionCreateBody;
  transport: GptLiveWebRtcTransport;
};

export type GptLiveCreateResponse = {
  session: { id: string };
  transport: { type: "webrtc"; sdp: string };
};

/** Wire events we care about from Live primary/sideband JSON streams. */
export type GptLiveWireEvent =
  | { type: "session.started"; event_id?: string; session?: { client?: unknown } }
  | {
      type: "session.input_transcript.delta";
      event_id?: string;
      delta: string;
      start_ms: number;
      end_ms: number;
    }
  | {
      type: "session.output_transcript.delta";
      event_id?: string;
      delta: string;
      start_ms: number;
      end_ms: number;
    }
  | {
      type: "session.delegation.created";
      event_id?: string;
      offset_ms: number;
      delegation: {
        id: string;
        type: "delegation";
        target: "client";
      };
    }
  | {
      type: "session.usage.updated";
      event_id?: string;
      usage: { seconds: number };
      context_window?: { usage_ratio?: number };
    }
  | {
      type: "session.closed";
      event_id?: string;
      reason?: string;
      usage?: { seconds: number };
    }
  | {
      type: "session.commentary.appended" | "session.thinking.appended" | "session.instructions.appended";
      event_id?: string;
      client_event_id?: string;
      start_ms?: number;
      end_ms?: number;
    }
  | {
      type: "error";
      event_id?: string;
      error?: { code?: string | null; message?: string; client_event_id?: string };
    }
  /** Reflected audio: base64 mono PCM16LE @ 24 kHz. Routed to the audio path, never the event bus. */
  | {
      type: "session.input_audio.append";
      audio: string;
    }
  | {
      type: "session.output_audio.delta";
      delta: string;
      start_ms?: number;
      end_ms?: number;
    };

export type GptLiveClientCommand =
  | {
      type: "session.commentary.append";
      event_id: string;
      /** null: session-wide context the model speaks, not tied to a delegation. */
      delegation_id: string | null;
      content: string;
    }
  | {
      type: "session.thinking.append";
      event_id: string;
      delegation_id: string;
      content: string;
    }
  | {
      type: "session.instructions.append";
      event_id: string;
      delegation_id: string | null;
      content: string;
    }
  | { type: "session.close"; event_id: string };

/** Conservative budget under the documented 8,192-token startup history limit (~4 chars/token). */
export const GPT_LIVE_HISTORY_LIMITS = {
  maxMessages: 128,
  maxTotalChars: 24_000,
  maxMessageChars: 2_000,
} as const;

/** Keep the most recent turns that fit the startup history budget. */
export function buildGptLiveInput(
  history: VoiceHistoryMessage[] | undefined,
): GptLiveInputMessage[] | undefined {
  if (!history?.length) return undefined;
  const picked: GptLiveInputMessage[] = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const item = history[i];
    if (!item) continue;
    const text = item.text.trim().slice(0, GPT_LIVE_HISTORY_LIMITS.maxMessageChars);
    if (!text) continue;
    if (picked.length >= GPT_LIVE_HISTORY_LIMITS.maxMessages) break;
    if (total + text.length > GPT_LIVE_HISTORY_LIMITS.maxTotalChars) break;
    total += text.length;
    picked.unshift({
      type: "message",
      role: item.role,
      content: [{ type: item.role === "user" ? "input_text" : "output_text", text }],
    });
  }
  return picked.length ? picked : undefined;
}

export function buildGptLiveCreateRequest(input: {
  sdpOffer: string;
  model: string;
  voice: string;
  instructions: string;
  history?: VoiceHistoryMessage[];
}): GptLiveCreateRequest {
  const seeded = buildGptLiveInput(input.history);
  return {
    session: {
      model: input.model,
      instructions: input.instructions,
      ...(seeded ? { input: seeded } : {}),
      audio: { output: { voice: input.voice } },
      delegation: { type: "client" },
      client: { data_channel: { allowed_client_events: [] } },
    },
    transport: { type: "webrtc", sdp: input.sdpOffer },
  };
}

export function mapGptLiveCloseReason(reason: string | undefined): SessionCloseReason {
  switch (reason) {
    case "close_requested":
    case "expired":
    case "content":
    case "remote_hangup":
    case "connection_lost":
      return reason;
    default:
      return "error";
  }
}

/**
 * Map a GPT-Live wire event into a provider-neutral VoiceControlEvent.
 * Returns null for events ChatAI ignores at the core layer (e.g. reflected audio).
 */
export function mapGptLiveWireEventToControlEvent(
  providerSessionId: string,
  wire: GptLiveWireEvent,
): VoiceControlEvent | null {
  switch (wire.type) {
    case "session.started":
      return {
        type: "session.started",
        providerSessionId,
        browserCommandsBlocked: isBrowserCommandLockConfirmed(wire.session),
      };
    case "session.input_transcript.delta":
      return {
        type: "transcript.input.delta",
        text: wire.delta,
        startMs: wire.start_ms,
        endMs: wire.end_ms,
      };
    case "session.output_transcript.delta":
      return {
        type: "transcript.output.delta",
        text: wire.delta,
        startMs: wire.start_ms,
        endMs: wire.end_ms,
      };
    case "session.delegation.created":
      return {
        type: "delegation.created",
        delegationId: wire.delegation.id,
        offsetMs: wire.offset_ms,
      };
    case "session.usage.updated":
      return { type: "usage.updated", seconds: wire.usage.seconds };
    case "session.closed":
      return {
        type: "session.closed",
        reason: mapGptLiveCloseReason(wire.reason),
        usageSeconds: wire.usage?.seconds ?? 0,
      };
    case "session.commentary.appended":
    case "session.thinking.appended":
    case "session.instructions.appended":
      return {
        type: "append.acknowledged",
        kind:
          wire.type === "session.commentary.appended"
            ? "commentary"
            : wire.type === "session.thinking.appended"
              ? "thinking"
              : "instructions",
        clientEventId: wire.client_event_id ?? null,
        startMs: typeof wire.start_ms === "number" ? wire.start_ms : null,
        endMs: typeof wire.end_ms === "number" ? wire.end_ms : null,
      };
    case "error":
      return {
        type: "error",
        code: wire.error?.code ?? "provider_error",
        message: wire.error?.message ?? "GPT-Live error",
      };
    case "session.input_audio.append":
    case "session.output_audio.delta":
      // Audio travels on the separate reflected-audio path (see mapGptLiveWireEventToAudioFrame).
      return null;
    default: {
      const _exhaustive: never = wire;
      void _exhaustive;
      return null;
    }
  }
}

/** Decode base64 PCM16LE into an aligned Int16Array (Buffer pool slices may be misaligned). */
export function decodePcm16Base64(b64: string): Int16Array {
  const bytes = Buffer.from(b64, "base64");
  const samples = new Int16Array(bytes.byteLength >> 1);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = bytes.readInt16LE(i * 2);
  }
  return samples;
}

/** Map reflected-audio wire events to frames; null for everything else. */
export function mapGptLiveWireEventToAudioFrame(wire: GptLiveWireEvent): ReflectedAudioFrame | null {
  if (wire.type === "session.input_audio.append") {
    return typeof wire.audio === "string"
      ? { source: "input", pcm: decodePcm16Base64(wire.audio) }
      : null;
  }
  if (wire.type === "session.output_audio.delta") {
    return typeof wire.delta === "string"
      ? {
          source: "output",
          pcm: decodePcm16Base64(wire.delta),
          startMs: typeof wire.start_ms === "number" ? wire.start_ms : null,
          endMs: typeof wire.end_ms === "number" ? wire.end_ms : null,
        }
      : null;
  }
  return null;
}
