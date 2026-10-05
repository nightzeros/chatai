import { describe, expect, it } from "vitest";

import { buildConversationExport } from "./conversation-export";

describe("buildConversationExport", () => {
  it("includes conversation and messages without secret fields", () => {
    const exported = buildConversationExport({
      assistantId: "asst-1",
      now: new Date("2026-08-24T12:00:00.000Z"),
      conversation: {
        id: "conv-1",
        source: "widget",
        visitorId: "visitor01",
        createdAt: new Date("2026-08-20T12:00:00.000Z"),
        updatedAt: new Date("2026-08-21T12:00:00.000Z"),
      },
      messages: [
        {
          id: "m1",
          role: "user",
          content: "Hello",
          sources: [],
          outcome: null,
          feedback: null,
          confidence: null,
          modality: "text",
          wasInterrupted: false,
          createdAt: new Date("2026-08-20T12:00:01.000Z"),
        },
        {
          id: "m2",
          role: "assistant",
          content: "Hi there",
          sources: [{ documentId: "d1", documentName: "Guide" }],
          outcome: "answered_with_context",
          feedback: "positive",
          confidence: 0.9,
          modality: "voice",
          wasInterrupted: false,
          createdAt: new Date("2026-08-20T12:00:02.000Z"),
        },
      ],
    });

    expect(exported.conversation.id).toBe("conv-1");
    expect(exported.messages).toHaveLength(2);
    expect(exported.messages[1]?.sources[0]?.documentName).toBe("Guide");

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("widgetSigningSecret");
    expect(serialized).not.toContain("ENCRYPTION_KEY");
    expect(serialized).not.toContain("password");
    expect(exported).not.toHaveProperty("securitySettings");
    expect(exported).not.toHaveProperty("debug");
  });
});
