import { describe, expect, it, vi } from "vitest";

import { ChatAI } from "./client";

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("ChatAI", () => {
  it("sends Bearer auth on REST calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ assistants: [{ id: "a1", name: "Bot" }] }));
    const client = new ChatAI({
      apiKey: "sk_live_test",
      baseUrl: "http://localhost:3000/",
      fetch: fetchMock,
    });

    const assistants = await client.listAssistants();
    expect(assistants[0]?.id).toBe("a1");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/assistants",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer sk_live_test" }),
      }),
    );
  });

  it("throws ChatAIError with Retry-After on 429", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: "Rate limit exceeded." }, 429, { "Retry-After": "42" }),
    );
    const client = new ChatAI({
      apiKey: "sk_live_test",
      baseUrl: "http://localhost:3000",
      fetch: fetchMock,
    });

    await expect(client.listAssistants()).rejects.toMatchObject({
      name: "ChatAIError",
      status: 429,
      retryAfter: 42,
    });
  });

  it("aggregates SSE chat tokens", async () => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"type":"token","text":"Hello"}\n\n'));
        controller.enqueue(
          encoder.encode(
            'data: {"type":"meta","messageId":"m1","conversationId":"c1","sources":[],"confidence":0.9,"outcome":"answered_with_context"}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const client = new ChatAI({
      apiKey: "sk_live_test",
      baseUrl: "http://localhost:3000",
      fetch: fetchMock,
    });

    const tokens: string[] = [];
    const result = await client.chat({
      assistantId: "asst_1",
      message: "Hi",
      onToken: (text) => tokens.push(text),
    });

    expect(tokens).toEqual(["Hello"]);
    expect(result).toMatchObject({
      answer: "Hello",
      conversationId: "c1",
      messageId: "m1",
      outcome: "answered_with_context",
    });
  });
});
