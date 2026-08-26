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
  | "processing_failure";

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
};

export type WidgetMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: WidgetSource[];
  feedback?: "positive" | "negative";
};

export type WidgetState = {
  status: "loading" | "ready" | "streaming" | "error";
  config?: WidgetConfig;
  conversationId?: string;
  messages: WidgetMessage[];
  error?: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

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
};

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
  let state: WidgetState = { status: "loading", messages: [] };

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
      if (!content || state.status === "streaming") return;

      const userMessage: WidgetMessage = { role: "user", content };
      let assistantMessage: WidgetMessage = { role: "assistant", content: "" };
      setState({
        ...state,
        status: "streaming",
        messages: [...state.messages, userMessage, assistantMessage],
        error: undefined,
      });

      try {
        const apiUrl = origin();
        const vid = visitorId();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const signature = await fetchSignatureHeader(vid);
        if (signature) {
          headers["X-ChatAI-Signature"] = signature;
        }

        const response = await fetcher(`${apiUrl}/api/v1/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            assistantId: options.assistantId,
            message: content,
            conversationId: state.conversationId,
            visitorId: vid,
            source: "widget",
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
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const signature = await fetchSignatureHeader(vid);
        if (signature) {
          headers["X-ChatAI-Signature"] = signature;
        }

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
    destroy() {
      listeners.clear();
    },
  };
}
