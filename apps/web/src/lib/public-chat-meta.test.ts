import { describe, expect, it } from "vitest";

import { publicChatMeta } from "./public-chat-meta";

const meta = {
  messageId: "message-1",
  conversationId: "conversation-1",
  sources: [],
  confidence: 0.91,
  outcome: "answered_with_context",
  debug: { model: "gpt-4o-mini", retrieval: [{ similarity: 0.91 }] },
};

describe("publicChatMeta", () => {
  it("omits RAG debug data from widget streams", () => {
    expect(publicChatMeta(meta, "widget")).toEqual({
      type: "meta",
      messageId: "message-1",
      conversationId: "conversation-1",
      sources: [],
      confidence: 0.91,
      outcome: "answered_with_context",
    });
  });

  it("retains debug data for the dashboard playground", () => {
    expect(publicChatMeta(meta, "playground", true)).toMatchObject({
      type: "meta",
      debug: meta.debug,
    });
  });

  it("redacts a spoofed playground source without an authenticated owner", () => {
    expect(publicChatMeta(meta, "playground", false)).toEqual({
      type: "meta",
      messageId: "message-1",
      conversationId: "conversation-1",
      sources: [],
      confidence: 0.91,
      outcome: "answered_with_context",
    });
  });
});
