import {
  classifyHeartbeatResponse,
  createControlHealthMonitor,
  isControlMuted,
  type ControlHealthMonitor,
  type ControlHealthSettings,
  type ControlHealthState,
  type HeartbeatOutcome,
} from "./control-health";
import { createPlaybackGate, type PlaybackGate, type PlaybackGateSettings } from "./voice-gate";
import {
  deriveVoicePhase,
  detectInterruption,
  isAssistantActive,
  isUserActive,
  type VoiceConnection,
  type VoicePhase,
  type VoiceSignals,
} from "./voice-state";
import { createVoiceTranscript, type VoiceTranscriptTurn } from "./voice-transcript";

/**
 * Browser side of a Topology B Voice session: mic + WebRTC media go straight to the
 * realtime provider; ChatAI mints the session (POST /api/v1/voice/sessions), runs
 * delegation/RAG/persistence on the sideband, and finalizes it on end. No provider
 * credential ever reaches the browser: the mint response carries only the SDP answer.
 */

export type VoiceErrorCode =
  | "unsupported"
  | "mic_denied"
  | "mic_unavailable"
  | "voice_unavailable"
  | "rate_limited"
  | "network"
  | "media_failed"
  | "server";

export type VoiceError = { code: VoiceErrorCode; message: string };

/** ChatAI ended the call itself (end endpoint or heartbeat), in visitor-safe terms. */
export type VoiceServerEndReason = "voice_unavailable" | "superseded" | "disconnected" | "idle" | "max_duration";

/** Neutral: visitors never see plan, billing, quota, remaining minutes or internals. */
export const VOICE_END_NOTICES: Record<VoiceServerEndReason, string> = {
  voice_unavailable: "Voice is unavailable for the rest of this conversation, but we can keep chatting here.",
  superseded: "Voice continued in another tab or window. You can keep typing here.",
  disconnected: "Voice disconnected. You can keep typing here.",
  idle: "Voice ended after a period of silence. You can keep typing here.",
  max_duration: "Voice reached its maximum length. You can keep typing here.",
};

/** Any server end reason → the visitor-safe form (owner-only values collapse). */
export function visitorEndReason(reported: unknown): VoiceServerEndReason | null {
  switch (reported) {
    case "voice_unavailable":
    case "usage_limit":
      return "voice_unavailable";
    case "superseded":
      return "superseded";
    case "idle":
      return "idle";
    case "max_duration":
      return "max_duration";
    case "disconnected":
    case "heartbeat_lost":
    case "control_lost":
    case "shutdown":
      return "disconnected";
    default:
      return null;
  }
}

export const VOICE_ERROR_MESSAGES: Record<VoiceErrorCode, string> = {
  unsupported: "Voice needs a browser with microphone and WebRTC support on a secure (HTTPS) page.",
  mic_denied: "Microphone access is blocked. Allow it in your browser settings to talk, or keep typing.",
  mic_unavailable: "No microphone is available. Check that one is connected and not in use by another app.",
  voice_unavailable: "Voice isn't available right now. You can keep typing.",
  rate_limited: "Too many voice requests. Please wait a moment and try again.",
  network: "Unable to reach the voice service. Check your connection and try again.",
  media_failed: "The voice connection dropped. Try again to continue.",
  server: "Voice could not start. Please try again.",
};

export type VoiceMediaDeps = {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createPeerConnection(): RTCPeerConnection;
  /** Null when Web Audio is unavailable; levels then fall back to transcript activity. */
  createAudioContext(): AudioContext | null;
  createAudioElement(): HTMLAudioElement | null;
};

export type ClientHistoryMessage = { role: "user" | "assistant"; content: string };

export type VoiceSessionSnapshot = {
  connection: VoiceConnection;
  phase: VoicePhase;
  error?: VoiceError;
  /** Storage is off for this assistant: nothing from this session is saved. */
  ephemeral?: boolean;
  /** Voice turns are saved as text in the conversation; false keeps them to this session. */
  transcriptSaved?: boolean;
  /** Durable conversation the session writes to (null for no-store). */
  conversationId?: string | null;
  /** Session audio is recorded for the assistant owner (the visitor consented). */
  recording?: boolean;
  /** Set when ChatAI ended the call; `notice` is the visitor-safe explanation. */
  endReason?: VoiceServerEndReason;
  notice?: string;
  /** Mock provider: control plane only, no audio. */
  mock: boolean;
  turns: VoiceTranscriptTurn[];
};

export type VoiceSessionOptions = {
  apiUrl: string;
  assistantId: string;
  visitorId: string;
  conversationId?: string;
  history: ClientHistoryMessage[];
  /** The visitor accepted the recording disclosure (sent only when true). */
  recordingConsent?: boolean;
  fetch: typeof fetch;
  media: VoiceMediaDeps;
  /** Request headers (Content-Type + optional widget signature). */
  headers(): Promise<Record<string, string>>;
  onChange(snapshot: VoiceSessionSnapshot): void;
  now?: () => number;
  /** Control-health timing overrides (tests). */
  controlHealth?: Partial<ControlHealthSettings> & { now?: () => number };
  /** Playback-gate stream timing overrides (tests). */
  playbackGate?: Partial<PlaybackGateSettings>;
};

export type VoiceEndReason = "close_requested" | "remote_hangup" | "connection_lost" | "error";

const MIC_RMS_THRESHOLD = 0.02;
const REMOTE_RMS_THRESHOLD = 0.01;
const TICK_MS = 100;
const ICE_GATHER_TIMEOUT_MS = 4_000;
/** A short filler spoken right after delegation does not end the lookup. */
const FILLER_WINDOW_MS = 1_200;
const PROCESSING_TIMEOUT_MS = 20_000;
/** WebRTC "disconnected" often recovers; fail only if it persists. */
const DISCONNECT_GRACE_MS = 5_000;
const MOCK_SDP_MARKER = "a=chatai-mock-session:";

type Analyser = { node: AnalyserNode; buffer: Float32Array<ArrayBuffer> };

type ProviderEvent = {
  type?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
};

/** Browser capability check; false in SSR, insecure contexts and old browsers. */
export function browserVoiceMedia(): VoiceMediaDeps | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  if (window.isSecureContext === false) return null;
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") return null;
  return {
    getUserMedia: (constraints) => mediaDevices.getUserMedia(constraints),
    createPeerConnection: () => new RTCPeerConnection(),
    createAudioContext: () => {
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      try {
        return Ctor ? new Ctor() : null;
      } catch {
        return null;
      }
    },
    createAudioElement: () => {
      if (typeof document === "undefined") return null;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      return audio;
    },
  };
}

function micError(error: unknown): VoiceError {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return { code: "mic_denied", message: VOICE_ERROR_MESSAGES.mic_denied };
  }
  if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
    return { code: "mic_unavailable", message: VOICE_ERROR_MESSAGES.mic_unavailable };
  }
  return { code: "server", message: VOICE_ERROR_MESSAGES.server };
}

async function mintError(response: Response): Promise<VoiceError> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; reason?: string };
  // Voice minutes used up / too many sessions: same neutral copy, no plan details.
  if (
    response.status === 402 ||
    body.reason === "voice_unavailable" ||
    body.reason === "voice_minutes_exhausted" ||
    body.reason === "voice_concurrency_limit"
  ) {
    return { code: "voice_unavailable", message: VOICE_ERROR_MESSAGES.voice_unavailable };
  }
  if (response.status === 429) return { code: "rate_limited", message: VOICE_ERROR_MESSAGES.rate_limited };
  if (response.status >= 500) {
    return { code: "voice_unavailable", message: VOICE_ERROR_MESSAGES.voice_unavailable };
  }
  if (response.status === 403 && /voice is not enabled/i.test(body.error ?? "")) {
    return { code: "voice_unavailable", message: VOICE_ERROR_MESSAGES.voice_unavailable };
  }
  // 4xx messages from ChatAI policies are visitor-safe (same as text chat).
  return { code: "server", message: body.error?.slice(0, 200) || VOICE_ERROR_MESSAGES.server };
}

function waitForIceGathering(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function rms(analyser: Analyser | null) {
  if (!analyser) return 0;
  analyser.node.getFloatTimeDomainData(analyser.buffer);
  let sum = 0;
  for (const sample of analyser.buffer) sum += sample * sample;
  return Math.sqrt(sum / analyser.buffer.length);
}

function analyse(ctx: AudioContext | null, stream: MediaStream): Analyser | null {
  if (!ctx) return null;
  try {
    const node = ctx.createAnalyser();
    node.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(node);
    return { node, buffer: new Float32Array(node.fftSize) };
  } catch {
    return null;
  }
}

export function createVoiceSession(options: VoiceSessionOptions) {
  // Never call as options.fetch(): native fetch throws "Illegal invocation" unless `this` is the global.
  const fetcher = options.fetch;
  const now = options.now ?? (() => Date.now());
  const transcript = createVoiceTranscript(`voice_${now().toString(36)}`);
  const signals: VoiceSignals = {
    connection: "idle",
    now: now(),
    userVoiceAt: null,
    assistantVoiceAt: null,
    processing: false,
    interruptedAt: null,
  };
  let phase: VoicePhase = "idle";
  let error: VoiceError | undefined;
  let ephemeral: boolean | undefined;
  let transcriptSaved: boolean | undefined;
  let conversationId: string | null | undefined;
  let recording: boolean | undefined;
  let endReason: VoiceServerEndReason | undefined;
  let mock = false;
  let sessionId: string | null = null;
  let lastHeaders: Record<string, string> = { "Content-Type": "application/json" };
  let stopped = false;

  let mic: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  let audio: HTMLAudioElement | null = null;
  let audioCtx: AudioContext | null = null;
  let micAnalyser: Analyser | null = null;
  let remoteAnalyser: Analyser | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let health: ControlHealthMonitor | null = null;
  /** Set when the server gates playback: assistant audio and captions only while open. */
  let gate: PlaybackGate | null = null;
  let controlMuted = false;
  let processingSince = 0;
  let userWasActive = false;
  const levels = { input: 0, output: 0 };

  const snapshot = (): VoiceSessionSnapshot => ({
    connection: signals.connection,
    phase,
    ...(error ? { error } : {}),
    ...(ephemeral !== undefined ? { ephemeral } : {}),
    ...(transcriptSaved !== undefined ? { transcriptSaved } : {}),
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(recording !== undefined ? { recording } : {}),
    ...(endReason ? { endReason, notice: VOICE_END_NOTICES[endReason] } : {}),
    mock,
    turns: transcript.turns(),
  });
  const emit = () => options.onChange(snapshot());

  const gateClosed = () => gate !== null && !gate.isOpen();
  const applyAudioMute = () => {
    if (audio) audio.muted = controlMuted || gateClosed();
  };

  const refreshPhase = (force = false) => {
    signals.now = now();
    const next = deriveVoicePhase(signals);
    if (next !== phase || force) {
      phase = next;
      emit();
    }
  };

  const setConnection = (next: VoiceConnection) => {
    signals.connection = next;
    refreshPhase(true);
  };

  const onTick = () => {
    const at = now();
    if (signals.connection === "reconnecting") {
      levels.input = 0;
      levels.output = 0;
      refreshPhase();
      return;
    }
    levels.input = rms(micAnalyser);
    // Withheld speech is neither shown as the assistant talking nor interruptible.
    levels.output = gateClosed() ? 0 : rms(remoteAnalyser);
    if (levels.input > MIC_RMS_THRESHOLD) signals.userVoiceAt = at;
    if (levels.output > REMOTE_RMS_THRESHOLD) signals.assistantVoiceAt = at;
    if (signals.processing && at - processingSince > PROCESSING_TIMEOUT_MS) signals.processing = false;
    signals.now = at;
    const userActive = isUserActive(signals);
    if (
      detectInterruption({
        userWasActive,
        userIsActive: userActive,
        assistantIsActive: isAssistantActive(signals),
      })
    ) {
      signals.interruptedAt = at;
    }
    userWasActive = userActive;
    refreshPhase();
  };

  const teardownMedia = () => {
    health?.stop();
    health = null;
    gate?.stop();
    gate = null;
    if (tick) clearInterval(tick);
    tick = null;
    if (disconnectTimer) clearTimeout(disconnectTimer);
    disconnectTimer = null;
    pc?.getSenders().forEach((sender) => sender.track?.stop());
    pc?.close();
    pc = null;
    mic?.getTracks().forEach((track) => track.stop());
    mic = null;
    if (audio) {
      audio.pause?.();
      audio.srcObject = null;
    }
    audio = null;
    void audioCtx?.close().catch(() => undefined);
    audioCtx = null;
    micAnalyser = null;
    remoteAnalyser = null;
    levels.input = 0;
    levels.output = 0;
    signals.processing = false;
    signals.userVoiceAt = null;
    signals.assistantVoiceAt = null;
    signals.interruptedAt = null;
  };

  const endServerSession = async (reason: VoiceEndReason, keepalive: boolean) => {
    const id = sessionId;
    sessionId = null;
    if (!id) return;
    const headers = keepalive ? lastHeaders : await options.headers().catch(() => lastHeaders);
    const response = await fetcher(
      `${options.apiUrl}/api/v1/voice/sessions/${encodeURIComponent(id)}/end`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ reason, visitorId: options.visitorId, source: "widget" }),
        keepalive,
      },
    ).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json().catch(() => null)) as { endReason?: unknown } | null;
    // Keep only the visitor-safe form client-side, whatever the server reports.
    const reported = visitorEndReason(body?.endReason);
    if (reported) {
      endReason = reported;
      // The media drop that followed a server-side end is not a connection error.
      if (signals.connection === "failed") {
        error = undefined;
        signals.connection = "ended";
      }
      refreshPhase(true);
    }
  };

  const fail = async (next: VoiceError, reason: VoiceEndReason = "error") => {
    if (stopped) return;
    stopped = true;
    error = next;
    teardownMedia();
    transcript.finish();
    setConnection("failed");
    await endServerSession(reason, false);
  };

  const setMediaMuted = (muted: boolean) => {
    // Disable (never stop) the mic track: media keeps flowing with packet timing intact.
    mic?.getTracks().forEach((track) => {
      track.enabled = !muted;
    });
    controlMuted = muted;
    applyAudioMute();
  };

  const startPlaybackGate = (id: string, token: string) => {
    gate = createPlaybackGate({
      connect: (signal) =>
        fetcher(`${options.apiUrl}/api/v1/voice/sessions/${encodeURIComponent(id)}/gate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal,
        }),
      onChange: () => {
        if (stopped) return;
        applyAudioMute();
        refreshPhase();
      },
      ...(options.playbackGate ? { settings: options.playbackGate } : {}),
    });
    applyAudioMute();
    gate.start();
  };

  /** ChatAI ended the call, or control stayed lost past the grace: end Voice, keep text. */
  const terminateForControl = async (reported: string | null) => {
    if (stopped) return;
    stopped = true;
    endReason = visitorEndReason(reported) ?? "disconnected";
    teardownMedia();
    transcript.finish();
    setConnection("ended");
    await endServerSession("connection_lost", false);
  };

  const onControlHealth = (next: ControlHealthState, previous: ControlHealthState) => {
    if (stopped) return;
    if (next.status === "terminated") {
      void terminateForControl(next.endReason);
      return;
    }
    const muted = isControlMuted(next.status);
    if (muted && !isControlMuted(previous.status)) {
      setMediaMuted(true);
      signals.processing = false;
      signals.userVoiceAt = null;
      signals.assistantVoiceAt = null;
      signals.interruptedAt = null;
      userWasActive = false;
      setConnection("reconnecting");
    } else if (!muted && signals.connection === "reconnecting") {
      setMediaMuted(false);
      setConnection("connected");
    }
  };

  const startControlHealth = (id: string, token: string, intervalMs: number | undefined) => {
    const { now: healthNow, ...settings } = options.controlHealth ?? {};
    const send = async (signal: AbortSignal): Promise<HeartbeatOutcome> => {
      const response = await fetcher(
        `${options.apiUrl}/api/v1/voice/sessions/${encodeURIComponent(id)}/heartbeat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
          signal,
        },
      );
      return classifyHeartbeatResponse(response.status, await response.json().catch(() => null));
    };
    health = createControlHealthMonitor({
      send,
      onChange: onControlHealth,
      intervalMs,
      settings,
      ...(healthNow ? { now: healthNow } : {}),
    });
    health.start();
  };

  /** Media dropped: while control is already lost this is the neutral disconnect, not an error. */
  const mediaLost = () => {
    if (signals.connection === "reconnecting") {
      void terminateForControl("disconnected");
      return;
    }
    void fail({ code: "media_failed", message: VOICE_ERROR_MESSAGES.media_failed }, "connection_lost");
  };

  const handleEvent = (event: ProviderEvent) => {
    const at = now();
    if (signals.connection === "reconnecting") {
      // Unsupervised provider activity is neither shown nor treated as the call going on.
      if (event.type === "session.closed") void terminateForControl("disconnected");
      return;
    }
    switch (event.type) {
      case "session.started":
        if (signals.connection === "connecting") setConnection("connected");
        return;
      case "session.input_transcript.delta":
        gate?.noteInput(event.start_ms);
        signals.userVoiceAt = at;
        transcript.input(event.delta ?? "", event.start_ms ?? at);
        refreshPhase(true);
        return;
      case "session.output_transcript.delta":
        if (gateClosed()) {
          // Not approved by ChatAI: no caption, and the visitor sees it is still working.
          if (!signals.processing) {
            signals.processing = true;
            processingSince = at;
          }
          refreshPhase(true);
          return;
        }
        signals.assistantVoiceAt = at;
        // Approved speech is the answer itself, never a filler.
        if (gate || (signals.processing && at - processingSince >= FILLER_WINDOW_MS)) signals.processing = false;
        transcript.output(event.delta ?? "", event.end_ms ?? at);
        refreshPhase(true);
        return;
      case "session.delegation.created":
        signals.processing = true;
        processingSince = at;
        refreshPhase();
        return;
      case "session.closed":
        void session.end("remote_hangup");
        return;
    }
  };

  const session = {
    snapshot,
    /** Mic/speaker levels (0–1-ish RMS) for visual feedback; read on animation frames. */
    levels() {
      return { ...levels };
    },
    async start() {
      if (signals.connection !== "idle") return;
      // Created synchronously inside the click so autoplay / audio policies allow playback.
      audio = options.media.createAudioElement();
      audioCtx = options.media.createAudioContext();
      setConnection("requesting_mic");

      try {
        mic = await options.media.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (caught) {
        await fail(micError(caught));
        return;
      }
      if (stopped) {
        teardownMedia();
        return;
      }

      setConnection("connecting");
      void audioCtx?.resume?.().catch(() => undefined);
      micAnalyser = analyse(audioCtx, mic);

      let answer: {
        sessionId?: string;
        sdpAnswer?: string;
        ephemeral?: boolean;
        transcriptSaved?: boolean;
        recording?: boolean;
        conversationId?: string | null;
        controlToken?: string;
        heartbeatIntervalMs?: number;
        playbackGate?: boolean;
      };
      try {
        const peer = options.media.createPeerConnection();
        pc = peer;
        mic.getTracks().forEach((track) => peer.addTrack(track, mic!));
        peer.addEventListener("track", (event) => {
          const [remote] = event.streams;
          if (!remote || pc !== peer) return;
          if (audio) {
            applyAudioMute();
            audio.srcObject = remote;
            void audio.play?.().catch(() => undefined);
          }
          remoteAnalyser = analyse(audioCtx, remote);
        });
        peer.addEventListener("connectionstatechange", () => {
          if (pc !== peer || stopped) return;
          const state = peer.connectionState;
          if (state === "connected") {
            if (disconnectTimer) clearTimeout(disconnectTimer);
            disconnectTimer = null;
            if (signals.connection === "connecting") setConnection("connected");
          } else if (state === "failed") {
            mediaLost();
          } else if (state === "disconnected" && !disconnectTimer) {
            disconnectTimer = setTimeout(() => {
              disconnectTimer = null;
              if (pc === peer && peer.connectionState !== "connected") mediaLost();
            }, DISCONNECT_GRACE_MS);
          }
        });

        // Must exist before the offer so it is negotiated in the SDP.
        const events = peer.createDataChannel("oai-events");
        events.addEventListener("message", (message) => {
          try {
            handleEvent(JSON.parse(String((message as MessageEvent).data)) as ProviderEvent);
          } catch {
            // Non-JSON frames are ignored.
          }
        });

        await peer.setLocalDescription(await peer.createOffer());
        await waitForIceGathering(peer);
        if (stopped) {
          teardownMedia();
          return;
        }

        lastHeaders = await options.headers();
        const response = await fetcher(`${options.apiUrl}/api/v1/voice/sessions`, {
          method: "POST",
          headers: lastHeaders,
          body: JSON.stringify({
            assistantId: options.assistantId,
            sdpOffer: peer.localDescription?.sdp ?? "",
            visitorId: options.visitorId,
            source: "widget",
            ...(options.conversationId ? { conversationId: options.conversationId } : {}),
            ...(options.history.length ? { history: options.history } : {}),
            ...(options.recordingConsent ? { recordingConsent: true } : {}),
            capabilities: ["heartbeat", "playback_gate"],
          }),
        });
        if (!response.ok) {
          await fail(await mintError(response));
          return;
        }
        answer = (await response.json()) as typeof answer;
        if (!answer.sessionId || !answer.sdpAnswer) {
          await fail({ code: "server", message: VOICE_ERROR_MESSAGES.server });
          return;
        }
        sessionId = answer.sessionId;
        if (stopped) {
          await endServerSession("close_requested", false);
          return;
        }
        ephemeral = Boolean(answer.ephemeral);
        transcriptSaved = answer.transcriptSaved ?? !ephemeral;
        conversationId = answer.conversationId ?? null;
        recording = Boolean(answer.recording);
        mock = answer.sdpAnswer.includes(MOCK_SDP_MARKER);
        // Before any remote audio can play: the gate starts closed.
        if (answer.playbackGate && answer.controlToken) startPlaybackGate(sessionId, answer.controlToken);
        if (!mock) await peer.setRemoteDescription({ type: "answer", sdp: answer.sdpAnswer });
      } catch (caught) {
        const offline = caught instanceof TypeError;
        await fail(
          offline
            ? { code: "network", message: VOICE_ERROR_MESSAGES.network }
            : { code: "server", message: VOICE_ERROR_MESSAGES.server },
          "error",
        );
        return;
      }

      if (stopped) return;
      tick = setInterval(onTick, TICK_MS);
      // Older servers return no token: no heartbeat loop, behavior as before.
      if (answer.controlToken && sessionId) {
        startControlHealth(sessionId, answer.controlToken, answer.heartbeatIntervalMs);
      }
      if (mock) setConnection("connected");
      else emit();
    },
    /**
     * Stops the mic and media immediately, then finalizes the server session.
     * `keepalive` lets the end request outlive a closing page.
     */
    async end(reason: VoiceEndReason = "close_requested", opts: { keepalive?: boolean } = {}) {
      if (stopped) {
        if (sessionId) await endServerSession(reason, Boolean(opts.keepalive));
        return;
      }
      stopped = true;
      teardownMedia();
      transcript.finish();
      setConnection(signals.connection === "idle" ? "idle" : "ended");
      await endServerSession(reason, Boolean(opts.keepalive));
    },
  };

  return session;
}

export type VoiceSession = ReturnType<typeof createVoiceSession>;
