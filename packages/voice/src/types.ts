import type { VoiceDelegationMode } from "./defaults";
import {
  DEFAULT_DELEGATION_MODE,
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
} from "./defaults";

/** Stable provider registry ids (adapter package owns mapping to vendor APIs). */
export type RealtimeVoiceProviderId = "mock" | "gpt-live" | (string & {});

/**
 * Provider-neutral session configuration.
 * Model and voice are strings so adapters can map vendor-specific ids.
 */
export type VoiceSessionConfig = {
  /** Realtime voice model id (e.g. gpt-live-1). */
  model: string;
  /** Speaking voice id (e.g. marin). */
  voice: string;
  /** Short conversational instructions for the live voice model. */
  instructions: string;
  /**
   * V1 production path is client-only.
   * Responses delegation is intentionally not a production architecture.
   */
  delegationMode: VoiceDelegationMode;
  /**
   * Prior text turns to seed the live model at startup (text→voice continuity).
   * Adapters must enforce vendor limits; never include system/trusted instructions here.
   */
  history?: VoiceHistoryMessage[];
};

export type VoiceHistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

export function resolveVoiceSessionConfig(
  partial?: Partial<VoiceSessionConfig>,
): VoiceSessionConfig {
  return {
    model: partial?.model?.trim() || DEFAULT_VOICE_MODEL,
    voice: partial?.voice?.trim() || DEFAULT_VOICE_ID,
    instructions: partial?.instructions?.trim() || "Be concise and helpful.",
    delegationMode: partial?.delegationMode ?? DEFAULT_DELEGATION_MODE,
    ...(partial?.history?.length ? { history: partial.history } : {}),
  };
}

export type CreateWebRtcSessionInput = {
  /** Browser SDP offer (Topology B: media stays browser↔provider). */
  sdpOffer: string;
  sessionConfig: VoiceSessionConfig;
  /** Opaque ChatAI correlation id (not sent to provider unless adapter chooses). */
  correlationId?: string;
};

export type WebRtcSessionCreateResult = {
  /** Provider-assigned session id. */
  providerSessionId: string;
  /** SDP answer for the browser peer connection. */
  sdpAnswer: string;
};

export type SessionCloseReason =
  | "close_requested"
  | "expired"
  | "content"
  | "remote_hangup"
  | "connection_lost"
  | "error";

/** Why the trusted sideband transport went away while the provider session may live on. */
export type ControlDisconnectCause = "closed" | "liveness_timeout" | "transport_error";

export type VoiceControlEvent =
  | {
      type: "session.started";
      providerSessionId: string;
      /**
       * The provider confirmed that the browser data channel may not send any
       * client→provider commands. Anything but `true` must be treated as unlocked.
       */
      browserCommandsBlocked?: boolean;
    }
  | {
      type: "transcript.input.delta";
      text: string;
      startMs: number;
      endMs: number;
    }
  | {
      type: "transcript.output.delta";
      text: string;
      startMs: number;
      endMs: number;
    }
  | {
      type: "delegation.created";
      delegationId: string;
      offsetMs: number;
    }
  | { type: "assistant.output.started"; delegationId?: string }
  /** Provider acknowledged an append (context delivered on the session timeline). */
  | {
      type: "append.acknowledged";
      kind: "commentary" | "thinking" | "instructions";
      clientEventId: string | null;
      startMs: number | null;
      endMs: number | null;
    }
  | { type: "assistant.interrupted"; atMs: number }
  | { type: "usage.updated"; seconds: number }
  | {
      type: "session.closed";
      reason: SessionCloseReason;
      usageSeconds: number;
    }
  /** Sideband lost before `session.closed`; the provider session may still be running. */
  | { type: "control.disconnected"; cause: ControlDisconnectCause; closeCode: number | null }
  /** Sideband re-attached after `control.disconnected`; replayed events were deduplicated. */
  | { type: "control.reattached"; gapMs: number }
  | {
      type: "error";
      code: string;
      message: string;
      retriable?: boolean;
    };

export type AppendRejectReason =
  | "superseded"
  | "completed"
  | "session_closed"
  | "unknown_delegation"
  | "invalid_content"
  | "provider_error";

export type AppendResult =
  /** eventId correlates with a later `append.acknowledged` when the adapter supports it. */
  | { ok: true; eventId?: string }
  | { ok: false; reason: AppendRejectReason; message?: string };

export type SessionCloseResult =
  | {
      ok: true;
      reason: SessionCloseReason;
      usageSeconds: number;
    }
  | {
      ok: false;
      reason: "already_closed" | "provider_error";
      message?: string;
      usageSeconds?: number;
      usageFinalized: boolean;
    };

/** Mono PCM16 sample rate of reflected audio frames. */
export const REFLECTED_AUDIO_SAMPLE_RATE = 24_000;

/**
 * Copy of session audio reflected to the server (never primary media).
 * `input` = visitor microphone as the provider received it (no timestamps);
 * `output` = assistant speech on the session timeline.
 */
export type ReflectedAudioFrame =
  | { source: "input"; pcm: Int16Array }
  | { source: "output"; pcm: Int16Array; startMs: number | null; endMs: number | null };

/**
 * Server-side control channel (Topology B sideband analogue).
 * Does not carry primary WebRTC media.
 */
export type VoiceControlChannel = {
  readonly providerSessionId: string;
  subscribe(listener: (event: VoiceControlEvent) => void): () => void;
  /**
   * Reflected session audio, kept off the control-event path so audio payloads
   * never reach event logs. Optional: adapters without reflection omit it.
   */
  subscribeAudio?(listener: (frame: ReflectedAudioFrame) => void): () => void;
  /** Speakable result for an active client delegation. */
  appendCommentary(delegationId: string, content: string): Promise<AppendResult>;
  /** Quiet context for an active client delegation. */
  appendThinking(delegationId: string, content: string): Promise<AppendResult>;
  /** Session-wide or delegation-scoped steering (may interrupt speech). */
  appendInstructions(
    content: string,
    delegationId?: string | null,
  ): Promise<AppendResult>;
  /** Graceful close; wait for session.closed semantics before tearing down. */
  close(reason?: SessionCloseReason): Promise<SessionCloseResult>;
  /** Transport currently open (false after `control.disconnected` or close). */
  isConnected?(): boolean;
  /**
   * Re-open the sideband after `control.disconnected`, keeping listeners, the
   * delegation tracker and replay deduplication. Rejects with
   * `ControlAttachError` (`sessionGone` when the provider session has ended).
   */
  reattach?(): Promise<void>;
};

/** Sideband attach failed; `sessionGone` means the provider session no longer exists. */
export class ControlAttachError extends Error {
  readonly status: number | null;
  readonly sessionGone: boolean;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ControlAttachError";
    this.status = status;
    this.sessionGone = status === 404;
  }
}

export type ProviderHangupResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "provider_error"; status?: number };

/**
 * Provider-neutral realtime voice adapter.
 * V1: WebRTC SDP exchange + control channel. No application-server audio proxy.
 */
export type RealtimeVoiceProvider = {
  readonly id: RealtimeVoiceProviderId;
  createWebRtcSession(
    input: CreateWebRtcSessionInput,
  ): Promise<WebRtcSessionCreateResult>;
  attachControlChannel(providerSessionId: string): Promise<VoiceControlChannel>;
  /**
   * Server-side hard stop that works without a sideband. Any attached sideband
   * observes `session.closed` (with final usage) as a result.
   */
  hangupSession?(providerSessionId: string): Promise<ProviderHangupResult>;
};
