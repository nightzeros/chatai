import type { MessageDebug, MessageOutcome, MessageSource } from "@chatai/database";

export type ChatMetaEvent = {
  type: "meta";
  messageId: string;
  conversationId: string;
  sources: MessageSource[];
  confidence: number;
  outcome: MessageOutcome;
  debug: MessageDebug;
};

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | ChatMetaEvent
  | { type: "done" };

export type StreamChatInput = {
  assistantId: string;
  message: string;
  conversationId?: string;
  visitorId?: string;
  source?: "playground" | "widget" | "api";
  signal?: AbortSignal;
};

export class ChatRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

export async function* streamChat(input: StreamChatInput): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch("/api/v1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: input.signal,
    body: JSON.stringify({
      assistantId: input.assistantId,
      message: input.message,
      conversationId: input.conversationId,
      visitorId: input.visitorId,
      source: input.source ?? "playground",
    }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ChatRequestError(data.error ?? "Chat request failed.", response.status);
  }

  if (!response.body) {
    throw new ChatRequestError("Empty response stream.", 500);
  }

  yield* parseSseStream(response.body);
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (event) yield event;
      }
    }

    const trailing = parseSseFrame(buffer + decoder.decode());
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(frame: string): ChatStreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  try {
    const parsed = JSON.parse(dataLines.join("\n")) as ChatStreamEvent;
    if (parsed.type === "token" || parsed.type === "meta" || parsed.type === "done") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}
