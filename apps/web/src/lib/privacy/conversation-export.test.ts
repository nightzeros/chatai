import { describe, expect, it } from "vitest";

import { buildConversationExport, sanitizeExportDebug } from "./conversation-export";

describe("sanitizeExportDebug", () => {
  it("keeps soak fields and drops retrieval dumps", () => {
    expect(
      sanitizeExportDebug({
        answerOwner: "agent",
        shadowAgent: false,
        question: "NightZeros latest project",
        searchQueries: [
          { raw: "what's their latest", rewritten: "NightZeros latest project" },
          { raw: "x", rewritten: "y", passage: "do not leak" },
        ],
        timings: { t_agent_draft_ms: 12, t_verify_ms: 3, t_purpose_ms: 4, t_validated_ready_ms: 20 },
        voice: { answeredBy: "server", welcome: true, delegationId: "del_1" },
        retrieval: [{ content: "secret passage" }],
      }),
    ).toEqual({
      answerOwner: "agent",
      shadowAgent: false,
      question: "NightZeros latest project",
      searchQueries: [{ raw: "what's their latest", rewritten: "NightZeros latest project" }, { raw: "x", rewritten: "y" }],
      timings: { t_agent_draft_ms: 12, t_verify_ms: 3, t_purpose_ms: 4, t_validated_ready_ms: 20 },
      voice: { answeredBy: "server", welcome: true, delegationId: "del_1" },
    });
  });
});

describe("buildConversationExport", () => {
  it("includes modality, wasInterrupted, and sanitized debug without secrets", () => {
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
          debug: {
            answerOwner: "agent",
            timings: { t_agent_draft_ms: 10, t_verify_ms: 2, t_purpose_ms: 1, t_validated_ready_ms: 15 },
            voice: { answeredBy: "server", welcome: true },
            retrieval: [{ content: "do not leak" }],
          },
          createdAt: new Date("2026-08-20T12:00:02.000Z"),
        },
      ],
    });

    expect(exported.conversation.id).toBe("conv-1");
    expect(exported.messages).toHaveLength(2);
    expect(exported.messages[1]?.sources[0]?.documentName).toBe("Guide");
    expect(exported.messages[1]).toMatchObject({
      modality: "voice",
      wasInterrupted: false,
      debug: {
        answerOwner: "agent",
        timings: { t_agent_draft_ms: 10, t_verify_ms: 2, t_purpose_ms: 1, t_validated_ready_ms: 15 },
        voice: { answeredBy: "server", welcome: true },
      },
    });
    expect(exported.messages[1]?.debug).not.toHaveProperty("retrieval");

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("widgetSigningSecret");
    expect(serialized).not.toContain("ENCRYPTION_KEY");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("do not leak");
    expect(exported).not.toHaveProperty("securitySettings");
    expect(exported).not.toHaveProperty("debug");
  });
});
