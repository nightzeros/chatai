export type ChatTokenEvent = { type: "token"; text: string };
export type ChatMetaEvent = {
  type: "meta";
  messageId: string;
  conversationId: string;
  sources: unknown[];
  confidence: number;
  outcome: string;
};
export type ChatDoneEvent = { type: "done" };
export type ChatStreamEvent = ChatTokenEvent | ChatMetaEvent | ChatDoneEvent;

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

export function parseSseFrame(frame: string): ChatStreamEvent | null {
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
