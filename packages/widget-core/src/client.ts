import {
  browserVoiceMedia,
  createVoiceSession,
  VOICE_ERROR_MESSAGES,
  type ClientHistoryMessage,
  type VoiceError,
  type VoiceMediaDeps,
  type VoiceSession,
  type VoiceSessionSnapshot,
} from "./voice";
import { isVoiceActive, type VoiceConnection, type VoicePhase } from "./voice-state";
import type { VoiceTranscriptTurn } from "./voice-transcript";

export type WidgetSource = {
  documentId: string;
  documentName: string;
  chunkId?: string;
  page?: number;
  excerpt?: string;
};

export type WidgetOutcome =
  | "answered_with_context"
  | "fallback_no_context"
  | "low_confidence"
  | "retrieval_failure"
  | "model_failure"
  | "processing_failure"
  | "conversational"
  | "answered_from_history";

export type WidgetStreamEvent =
  | { type: "token"; text: string }
  | {
      type: "meta";
      messageId: string;
      conversationId: string;
      sources: WidgetSource[];
      confidence: number;
      outcome: WidgetOutcome;
    }
  | { type: "done" };

export type WidgetConfig = {
  assistantId: string;
  name: string;
  welcomeMessage: string;
  settings: Record<string, unknown>;
  /** When true, chat/feedback require X-ChatAI-Signature from the sign endpoint. */
  requireWidgetSigning?: boolean;
  /** Public Voice availability (assistant enabled it and the instance supports it). */
  voice?: {
    enabled: boolean;
    /** Sessions are recorded: the visitor must accept a disclosure before the mic is requested. */
    recording?: { consentRequired: boolean };
  };
};

export type WidgetMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: WidgetSource[];
  feedback?: "positive" | "negative";
  modality?: "text" | "voice";
  /** Voice: the visitor spoke over this assistant turn. */
  interrupted?: boolean;
  /** Voice: still being spoken. */
  live?: boolean;
  /** Voice turn the server did not save (storage on, Voice transcripts off); never reused as history. */
  unsaved?: boolean;
};

export type WidgetVoiceState = {
  connection: VoiceConnection;
  phase: VoicePhase;
  error?: VoiceError;
  ephemeral?: boolean;
  /** False when Voice turns are not saved as text in the conversation. */
  transcriptSaved?: boolean;
  /** The recording disclosure is showing; the mic has not been requested. */
  consentPending?: boolean;
  /** This session's audio is being recorded (the visitor consented). */
  recording?: boolean;
  /** Visitor-safe explanation when ChatAI ended the call (e.g. usage limit). */
  notice?: string;
  mock?: boolean;
};

export type WidgetState = {
  status: "loading" | "ready" | "streaming" | "error";
  config?: WidgetConfig;
  conversationId?: string;
  messages: WidgetMessage[];
  error?: string;
  voice: WidgetVoiceState;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const CLIENT_HISTORY_LIMIT = 12;
const CLIENT_HISTORY_MAX_CHARS = 1_500;

const IDLE_VOICE: WidgetVoiceState = { connection: "idle", phase: "idle" };

export type WidgetControllerOptions = {
  assistantId: string;
  apiUrl: string;
  fetch?: typeof fetch;
  storage?: StorageLike;
  createId?: () => string;
  /**
   * Absolute URL for POST /api/v1/widget/sign.
   * Defaults to `${apiUrl}/api/v1/widget/sign` when config.requireWidgetSigning is true.
   */
  signEndpoint?: string;
  /** Browser media for Voice; defaults to the real browser APIs (null = unsupported). */
  voiceMedia?: VoiceMediaDeps | null;
};

/** Recent turns the server uses when nothing is stored (no-store). */
export function clientHistory(messages: WidgetMessage[]): ClientHistoryMessage[] {
  return messages
    .filter((message) => message.content.trim() && !message.live && !message.unsaved)
    .slice(-CLIENT_HISTORY_LIMIT)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, CLIENT_HISTORY_MAX_CHARS),
    }));
}

function voiceMessages(turns: VoiceTranscriptTurn[], live: boolean, unsaved: boolean): WidgetMessage[] {
  return turns.map((turn, index) => ({
    id: undefined,
    role: turn.role,
    content: turn.text,
    modality: "voice",
    ...(turn.interrupted ? { interrupted: true } : {}),
    ...(live && index === turns.length - 1 ? { live: true } : {}),
    ...(unsaved ? { unsaved: true } : {}),
  }));
}

export function resolveApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Widget API URL must be an absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Widget API URL must use HTTP or HTTPS.");
  }

  return url.origin;
}

function parseFrame(frame: string): WidgetStreamEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) return null;

  try {
    const event = JSON.parse(data) as { type?: string; [key: string]: unknown };
    if (event.type === "token" && typeof event.text === "string") {
      return { type: "token", text: event.text };
    }
    if (
      event.type === "meta" &&
      typeof event.messageId === "string" &&
      typeof event.conversationId === "string" &&
      Array.isArray(event.sources) &&
      typeof event.confidence === "number" &&
      typeof event.outcome === "string"
    ) {
      return {
        type: "meta",
        messageId: event.messageId,
        conversationId: event.conversationId,
        sources: event.sources as WidgetSource[],
        confidence: event.confidence,
        outcome: event.outcome as WidgetOutcome,
      };
    }
    if (event.type === "done") return { type: "done" };
  } catch {
    return null;
  }

  return null;
}

export function createSseParser() {
  let buffer = "";

  return {
    push(chunk: string): WidgetStreamEvent[] {
      buffer += chunk;
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      return frames.flatMap((frame) => {
        const event = parseFrame(frame);
        return event ? [event] : [];
      });
    },
    finish(): WidgetStreamEvent[] {
      const event = parseFrame(buffer);
      buffer = "";
      return event ? [event] : [];
    },
  };
}

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function randomId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback must satisfy widget visitorId rules: [a-zA-Z0-9_-]{8,80}
  return `v_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function responseError(response: Response) {
  return response
    .json()
    .then((data: { error?: string }) => data.error ?? "Widget request failed.")
    .catch(() => "Widget request failed.");
}

/** Maps offline / CORS / DNS failures to a visitor-safe message. */
function humanizeNetworkError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message;
  if (/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message)) {
    return "Unable to reach the ChatAI server. Check your connection and try again.";
  }
  return message || fallback;
}

export function createWidgetController(options: WidgetControllerOptions) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const storage = options.storage ?? defaultStorage();
  const createId = options.createId ?? randomId;
  const visitorKey = `chatai.widget.${options.assistantId}.visitor`;
  const conversationKey = `chatai.widget.${options.assistantId}.conversation`;
  const listeners = new Set<(state: WidgetState) => void>();
  let state: WidgetState = { status: "loading", messages: [], voice: IDLE_VOICE };
  const voiceMedia = options.voiceMedia === undefined ? browserVoiceMedia() : options.voiceMedia;
  let voiceSession: VoiceSession | null = null;
  /** Messages before the current Voice session; Voice turns are appended after them. */
  let voiceBase = 0;
  /** Voice became unavailable in this conversation; lets text chat answer "why did voice end?". */
  let voiceUnavailable = false;
  let removePageHide: (() => void) | null = null;

  const origin = () => resolveApiUrl(options.apiUrl);

  const emit = () => listeners.forEach((listener) => listener(state));
  const setState = (next: WidgetState) => {
    state = next;
    emit();
  };
  const visitorId = () => {
    const existing = storage?.getItem(visitorKey);
    if (existing) return existing;
    const created = createId();
    storage?.setItem(visitorKey, created);
    return created;
  };

  const resolveSignEndpoint = () => {
    if (options.signEndpoint?.trim()) {
      return options.signEndpoint.trim();
    }
    if (state.config?.requireWidgetSigning) {
      return `${origin()}/api/v1/widget/sign`;
    }
    return null;
  };

  const fetchSignatureHeader = async (vid: string): Promise<string | null> => {
    const endpoint = resolveSignEndpoint();
    if (!endpoint) return null;

    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assistantId: options.assistantId,
        visitorId: vid,
      }),
    });
    if (!response.ok) {
      throw new Error(await responseError(response));
    }
    const body = (await response.json()) as { signature?: string };
    if (!body.signature) {
      throw new Error("Widget sign endpoint returned no signature.");
    }
    return body.signature;
  };

  const requestHeaders = async (vid: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const signature = await fetchSignatureHeader(vid);
    if (signature) headers["X-ChatAI-Signature"] = signature;
    return headers;
  };

  const applyVoiceSnapshot = (session: VoiceSession, snap: VoiceSessionSnapshot) => {
    if (voiceSession !== session) return;
    const active = isVoiceActive(snap.connection);
    if (snap.endReason === "voice_unavailable") voiceUnavailable = true;
    let conversationId = state.conversationId;
    if (snap.conversationId) {
      conversationId = snap.conversationId;
      storage?.setItem(conversationKey, snap.conversationId);
    }
    state = {
      ...state,
      conversationId,
      messages: [
        ...state.messages.slice(0, voiceBase),
        ...voiceMessages(snap.turns, active, snap.ephemeral === false && snap.transcriptSaved === false),
      ],
      voice: {
        connection: snap.connection,
        phase: snap.phase,
        ...(snap.error ? { error: snap.error } : {}),
        ...(snap.ephemeral !== undefined ? { ephemeral: snap.ephemeral } : {}),
        ...(snap.transcriptSaved !== undefined ? { transcriptSaved: snap.transcriptSaved } : {}),
        ...(snap.recording ? { recording: true } : {}),
        ...(snap.notice ? { notice: snap.notice } : {}),
        ...(snap.mock ? { mock: true } : {}),
      },
    };
    if (!active) {
      removePageHide?.();
      removePageHide = null;
    }
    emit();
  };

  const watchPageHide = (session: VoiceSession) => {
    if (typeof window === "undefined") return;
    const onPageHide = () => void session.end("close_requested", { keepalive: true });
    window.addEventListener("pagehide", onPageHide);
    removePageHide = () => window.removeEventListener("pagehide", onPageHide);
  };

  const consentRequired = () =>
    Boolean(state.config?.voice?.enabled && state.config.voice.recording?.consentRequired);

  const beginVoice = async (recordingConsent: boolean) => {
    if (!voiceMedia) {
      state = {
        ...state,
        voice: {
          connection: "failed",
          phase: "error",
          error: { code: "unsupported", message: VOICE_ERROR_MESSAGES.unsupported },
        },
      };
      emit();
      return;
    }

    let apiUrl: string;
    try {
      apiUrl = origin();
    } catch (error) {
      setState({ ...state, error: humanizeNetworkError(error, "Unable to start voice.") });
      return;
    }
    const vid = visitorId();
    voiceBase = state.messages.length;
    const session: VoiceSession = createVoiceSession({
      apiUrl,
      assistantId: options.assistantId,
      visitorId: vid,
      conversationId: state.conversationId,
      history: clientHistory(state.messages),
      recordingConsent,
      fetch: fetcher,
      media: voiceMedia,
      headers: () => requestHeaders(vid),
      onChange: (snap) => applyVoiceSnapshot(session, snap),
    });
    voiceSession = session;
    state = { ...state, error: undefined };
    watchPageHide(session);
    await session.start();
  };

  return {
    getState() {
      return state;
    },
    subscribe(listener: (next: WidgetState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      setState({ ...state, status: "loading", error: undefined });
      try {
        const apiUrl = origin();
        const response = await fetcher(
          `${apiUrl}/api/v1/assistants/${encodeURIComponent(options.assistantId)}/config`,
        );
        if (!response.ok) throw new Error(await responseError(response));
        const config = (await response.json()) as WidgetConfig;
        setState({
          ...state,
          status: "ready",
          config,
          conversationId: storage?.getItem(conversationKey) ?? undefined,
        });
      } catch (error) {
        setState({
          ...state,
          status: "error",
          error: humanizeNetworkError(error, "Unable to load the assistant."),
        });
      }
    },
    async send(message: string) {
      const content = message.trim();
      // One live channel at a time keeps both modalities on the same history.
      if (!content || state.status === "streaming" || isVoiceActive(state.voice.connection)) return;

      const userMessage: WidgetMessage = { role: "user", content };
      let assistantMessage: WidgetMessage = { role: "assistant", content: "" };
      // Used by the server only when it keeps no transcript (storeConversations off).
      const history = clientHistory(state.messages);

      setState({
        ...state,
        status: "streaming",
        messages: [...state.messages, userMessage, assistantMessage],
        error: undefined,
      });

      try {
        const apiUrl = origin();
        const vid = visitorId();
        const headers = await requestHeaders(vid);

        const response = await fetcher(`${apiUrl}/api/v1/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            assistantId: options.assistantId,
            message: content,
            conversationId: state.conversationId,
            visitorId: vid,
            source: "widget",
            ...(history.length ? { history } : {}),
            ...(voiceUnavailable ? { voiceUnavailable: true } : {}),
          }),
        });
        if (!response.ok || !response.body) {
          throw new Error(response.body ? await responseError(response) : "Empty chat response.");
        }

        const parser = createSseParser();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const consume = (event: WidgetStreamEvent) => {
          if (event.type === "token") {
            assistantMessage = { ...assistantMessage, content: assistantMessage.content + event.text };
          }
          if (event.type === "meta") {
            assistantMessage = { ...assistantMessage, id: event.messageId, sources: event.sources };
            storage?.setItem(conversationKey, event.conversationId);
            state = { ...state, conversationId: event.conversationId };
          }
          state = {
            ...state,
            messages: [...state.messages.slice(0, -1), assistantMessage],
          };
          emit();
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.push(decoder.decode(value, { stream: true }))) consume(event);
        }
        for (const event of parser.push(decoder.decode())) consume(event);
        for (const event of parser.finish()) consume(event);
        setState({ ...state, status: "ready" });
      } catch (error) {
        setState({
          ...state,
          status: "error",
          error: humanizeNetworkError(error, "Unable to send the message."),
        });
      }
    },
    async sendFeedback(messageId: string, rating: "positive" | "negative") {
      try {
        const apiUrl = origin();
        const vid = visitorId();
        const headers = await requestHeaders(vid);

        const response = await fetcher(`${apiUrl}/api/v1/feedback`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            messageId,
            rating,
            visitorId: vid,
          }),
        });
        if (!response.ok) throw new Error(await responseError(response));

        state = {
          ...state,
          messages: state.messages.map((message) =>
            message.id === messageId ? { ...message, feedback: rating } : message,
          ),
          error: undefined,
        };
        emit();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to save feedback.";
        setState({ ...state, error: message });
        throw error;
      }
    },
    /** Voice can be offered: enabled for this assistant and supported by this browser. */
    voiceAvailable() {
      return Boolean(state.config?.voice?.enabled);
    },
    voiceSupported() {
      return voiceMedia !== null;
    },
    /** Voice sessions are recorded, so starting one shows the disclosure first. */
    voiceConsentRequired() {
      return consentRequired();
    },
    /**
     * Start Voice. When sessions are recorded this only opens the disclosure;
     * the mic and the session wait for `acceptRecordingConsent()`.
     */
    async startVoice() {
      if (!state.config?.voice?.enabled) return;
      if (isVoiceActive(state.voice.connection) || state.status === "streaming") return;
      if (consentRequired()) {
        setState({ ...state, error: undefined, voice: { ...IDLE_VOICE, consentPending: true } });
        return;
      }
      await beginVoice(false);
    },
    async acceptRecordingConsent() {
      if (!state.voice.consentPending) return;
      state = { ...state, voice: IDLE_VOICE };
      await beginVoice(true);
    },
    /** Back to text chat; nothing was requested or started. */
    declineRecordingConsent() {
      if (!state.voice.consentPending) return;
      setState({ ...state, voice: IDLE_VOICE });
    },
    async endVoice() {
      await voiceSession?.end("close_requested");
    },
    /** Live mic/speaker levels for the waveform; zeros when Voice is off. */
    voiceLevels() {
      return voiceSession?.levels() ?? { input: 0, output: 0 };
    },
    /** Clears a Voice error or end notice so the visitor can return to text or try again. */
    dismissVoiceError() {
      if (isVoiceActive(state.voice.connection)) return;
      setState({ ...state, voice: IDLE_VOICE });
    },
    destroy() {
      const session = voiceSession;
      voiceSession = null;
      removePageHide?.();
      removePageHide = null;
      void session?.end("close_requested", { keepalive: true });
      listeners.clear();
    },
  };
}
