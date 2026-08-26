import { describe, expect, it } from "vitest";

import { createSseParser, createWidgetController, resolveApiUrl } from "./client";

describe("resolveApiUrl", () => {
  it("normalizes an absolute API origin without a trailing slash", () => {
    expect(resolveApiUrl("https://chat.example.com/")).toBe("https://chat.example.com");
  });

  it("rejects a relative URL because embeds run cross-origin", () => {
    expect(() => resolveApiUrl("/api")).toThrow("absolute URL");
  });
});

describe("createSseParser", () => {
  it("emits a complete event when an SSE frame is split between chunks", () => {
    const parser = createSseParser();

    expect(parser.push('data: {"type":"token","text":"Hel')).toEqual([]);
    expect(parser.push('lo"}\n\n')).toEqual([{ type: "token", text: "Hello" }]);
  });

  it("does not expose debug fields from widget meta events", () => {
    const parser = createSseParser();

    expect(
      parser.push(
        'data: {"type":"meta","messageId":"m1","conversationId":"c1","sources":[],"confidence":0.8,"outcome":"answered_with_context","debug":{"model":"private"}}\n\n',
      ),
    ).toEqual([
      {
        type: "meta",
        messageId: "m1",
        conversationId: "c1",
        sources: [],
        confidence: 0.8,
        outcome: "answered_with_context",
      },
    ]);
  });
});

describe("createWidgetController", () => {
  it("records a load error instead of throwing when the API URL is missing", async () => {
    const controller = createWidgetController({
      assistantId: "asst_demo",
      apiUrl: undefined as unknown as string,
    });

    await controller.load();

    expect(controller.getState()).toMatchObject({
      status: "error",
      error: expect.stringMatching(/absolute URL/i),
    });
  });

  it("loads public config then posts widget chat with persistent visitor state", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const storage = new Map<string, string>();
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/config")) {
        return Response.json({
          assistantId: "asst_demo",
          name: "Demo",
          welcomeMessage: "Welcome",
          settings: { showSources: true },
        });
      }
      return new Response(
        'data: {"type":"token","text":"Hello"}\n\ndata: {"type":"meta","messageId":"m1","conversationId":"c1","sources":[],"confidence":0.9,"outcome":"answered_with_context"}\n\ndata: {"type":"done"}\n\n',
      );
    };
    const controller = createWidgetController({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      fetch: fetcher,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      createId: () => "visitor-1",
    });

    await controller.load();
    await controller.send("Hello");

    expect(calls[0]?.url).toBe("https://chat.example.com/api/v1/assistants/asst_demo/config");
    expect(calls[1]?.url).toBe("https://chat.example.com/api/v1/chat");
    expect(calls[1]?.init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.stringify(calls[1]?.init?.headers ?? {})).not.toMatch(/authorization/i);
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      assistantId: "asst_demo",
      message: "Hello",
      source: "widget",
      visitorId: "visitor-1",
    });
    expect(controller.getState()).toMatchObject({
      status: "ready",
      conversationId: "c1",
    });
    expect(controller.getState().messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "m1", role: "assistant", content: "Hello" })]),
    );
  });

  it("posts a rating for an assistant response using the persistent visitor token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/config")) {
        return Response.json({
          assistantId: "asst_demo",
          name: "Demo",
          welcomeMessage: "Welcome",
          settings: {},
        });
      }
      if (String(url).endsWith("/chat")) {
        return new Response(
          'data: {"type":"meta","messageId":"message-1","conversationId":"conversation-1","sources":[],"confidence":0.9,"outcome":"answered_with_context"}\n\ndata: {"type":"done"}\n\n',
        );
      }
      return Response.json({ ok: true, feedback: "positive" });
    };
    const controller = createWidgetController({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      fetch: fetcher,
      storage: {
        getItem: (key) => (key.endsWith(".visitor") ? "visitor-1" : null),
        setItem: () => undefined,
      },
    });

    await controller.load();
    await controller.send("Hello");
    await controller.sendFeedback("message-1", "positive");

    expect(calls[2]).toEqual(
      expect.objectContaining({
        url: "https://chat.example.com/api/v1/feedback",
        init: expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ messageId: "message-1", rating: "positive", visitorId: "visitor-1" }),
        }),
      }),
    );
    expect(controller.getState().messages).toContainEqual(
      expect.objectContaining({ id: "message-1", feedback: "positive" }),
    );
  });

  it("surfaces a recoverable offline message when config fetch fails", async () => {
    const controller = createWidgetController({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await controller.load();

    expect(controller.getState()).toMatchObject({
      status: "error",
      error: expect.stringMatching(/Unable to reach the ChatAI server/i),
    });
  });

  it("fetches a signature before chat when requireWidgetSigning is set", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const storage = new Map<string, string>();
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/config")) {
        return Response.json({
          assistantId: "asst_demo",
          name: "Demo",
          welcomeMessage: "Welcome",
          settings: {},
          requireWidgetSigning: true,
        });
      }
      if (String(url).endsWith("/widget/sign")) {
        return Response.json({ timestamp: 1, signature: "t=1,v1=abc" });
      }
      return new Response(
        'data: {"type":"token","text":"Hi"}\n\ndata: {"type":"meta","messageId":"m1","conversationId":"c1","sources":[],"confidence":0.9,"outcome":"answered_with_context"}\n\ndata: {"type":"done"}\n\n',
      );
    };
    const controller = createWidgetController({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      fetch: fetcher,
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
      },
      createId: () => "visitor01",
    });

    await controller.load();
    await controller.send("Hello");

    expect(calls.map((c) => c.url)).toEqual([
      "https://chat.example.com/api/v1/assistants/asst_demo/config",
      "https://chat.example.com/api/v1/widget/sign",
      "https://chat.example.com/api/v1/chat",
    ]);
    expect(calls[2]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-ChatAI-Signature": "t=1,v1=abc",
    });
  });
});
