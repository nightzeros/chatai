import {
  connectPlaybackGate,
  createPlaybackGate,
  VOICE_CLIENT_CAPABILITIES,
  type ClientHistoryMessage,
  type PlaybackGate,
  type PlaybackGateSettings,
} from "@nightzeros/chatai-widget-core";

export type PlaygroundMintInput = {
  assistantId: string;
  sdpOffer: string;
  visitorId: string;
  conversationId?: string | null;
  history: ClientHistoryMessage[];
  recordingConsent: boolean;
};

/** The Playground mints like the widget: same capabilities, `source: "playground"`. */
export function buildPlaygroundMintBody(input: PlaygroundMintInput) {
  return {
    assistantId: input.assistantId,
    sdpOffer: input.sdpOffer,
    visitorId: input.visitorId,
    // The server binds only durable sessions; no-store reads prior turns without writing.
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    history: input.history,
    source: "playground" as const,
    ...(input.recordingConsent ? { recordingConsent: true } : {}),
    capabilities: [...VOICE_CLIENT_CAPABILITIES],
  };
}

export type PlaygroundPlayback = {
  /** Before any remote audio can play: the gate starts closed. */
  startGate(sessionId: string, token: string): void;
  /** Control-health muting; independent of the gate. */
  setControlMuted(muted: boolean): void;
  /** Re-applies the mute, e.g. when a new remote track arrives. */
  refresh(): void;
  /** Whether assistant output may be heard and shown now. */
  audible(): boolean;
  noteInput(startMs: number | undefined): void;
  /** Ends the gate and resets both mute reasons; the audio stays as it is until the next session applies. */
  stop(): void;
};

/**
 * Assistant playback for the owner Playground. Audio is muted while ChatAI control
 * is unavailable or the server's playback gate is closed; with no gate (an older
 * server) playback follows control health only.
 */
export function createPlaygroundPlayback(options: {
  setAudioMuted(muted: boolean): void;
  onGateChange?(open: boolean): void;
  fetch?: typeof fetch;
  settings?: Partial<PlaybackGateSettings>;
}): PlaygroundPlayback {
  let controlMuted = false;
  let gate: PlaybackGate | null = null;

  const audible = () => gate === null || gate.isOpen();
  const apply = () => options.setAudioMuted(controlMuted || !audible());

  return {
    startGate(sessionId, token) {
      gate?.stop();
      const next = createPlaybackGate({
        connect: (signal) =>
          connectPlaybackGate({ apiUrl: "", sessionId, token, signal, ...(options.fetch ? { fetch: options.fetch } : {}) }),
        onChange: (open) => {
          if (gate !== next) return;
          apply();
          options.onGateChange?.(open);
        },
        ...(options.settings ? { settings: options.settings } : {}),
      });
      gate = next;
      apply();
      next.start();
    },
    setControlMuted(muted) {
      controlMuted = muted;
      apply();
    },
    refresh: apply,
    audible,
    noteInput(startMs) {
      gate?.noteInput(startMs);
    },
    stop() {
      // Never unmute here: the ending session's stream may still carry withheld speech.
      gate?.stop();
      gate = null;
      controlMuted = false;
    },
  };
}
