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
    expect(publicChatMeta(meta)).toEqual({
      type: "meta",
      messageId: "message-1",
      conversationId: "conversation-1",
      sources: [],
      confidence: 0.91,
      outcome: "answered_with_context",
    });
  });

  it("retains debug data for the verified owner", () => {
    expect(publicChatMeta(meta, true)).toMatchObject({
      type: "meta",
      debug: meta.debug,
    });
  });

  it("relabels internal outcomes unless the verified owner is viewing", () => {
    const outOfScope = { ...meta, outcome: "out_of_scope" };
    expect(publicChatMeta(outOfScope, false)).toMatchObject({ outcome: "conversational" });
    expect(publicChatMeta(outOfScope, false)).not.toHaveProperty("debug");
    expect(publicChatMeta(outOfScope, true)).toMatchObject({ outcome: "out_of_scope" });
  });
});
