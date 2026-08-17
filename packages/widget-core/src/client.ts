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
};

export type WidgetMessage = {
  role: "user" | "assistant";
  content: string;
  sources?: WidgetSource[];
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
  return Math.random().toString(36).slice(2);
}

function responseError(response: Response) {
  return response
    .json()
    .then((data: { error?: string }) => data.error ?? "Widget request failed.")
    .catch(() => "Widget request failed.");
}

export function createWidgetController(options: WidgetControllerOptions) {
  const apiUrl = resolveApiUrl(options.apiUrl);
  const fetcher = options.fetch ?? globalThis.fetch;
  const storage = options.storage ?? defaultStorage();
  const createId = options.createId ?? randomId;
  const visitorKey = `chatai.widget.${options.assistantId}.visitor`;
  const conversationKey = `chatai.widget.${options.assistantId}.conversation`;
  const listeners = new Set<(state: WidgetState) => void>();
  let state: WidgetState = { status: "loading", messages: [] };

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
          error: error instanceof Error ? error.message : "Unable to load the assistant.",
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
        const response = await fetcher(`${apiUrl}/api/v1/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assistantId: options.assistantId,
            message: content,
            conversationId: state.conversationId,
            visitorId: visitorId(),
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
            assistantMessage = { ...assistantMessage, sources: event.sources };
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
          error: error instanceof Error ? error.message : "Unable to send the message.",
        });
      }
    },
    destroy() {
      listeners.clear();
    },
  };
}
