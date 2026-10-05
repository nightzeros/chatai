import { describe, expect, it } from "vitest";

import type { ConversationSource, MessageOutcome } from "@chatai/database";

import {
  buildConversationListItems,
  classifyConversation,
  conversationVisitorLabel,
  matchesConversationFilter,
  parseConversationTypeFilter,
  groupConversationsByDay,
  toTranscriptMessages,
  truncatePreview,
} from "./conversation-list";

type ConversationRow = {
  id: string;
  source: ConversationSource;
  visitorId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Array<{ documentId: string; documentName: string }>;
  outcome?: MessageOutcome | null;
  debug?: { question?: string } | null;
  feedback?: "positive" | "negative" | null;
  confidence?: number | null;
  createdAt: Date;
};

function conversation(overrides: Partial<ConversationRow> & Pick<ConversationRow, "id">): ConversationRow {
  return {
    source: "widget",
    visitorId: "visitor-token-abcdef",
    createdAt: new Date("2026-08-17T10:00:00.000Z"),
    updatedAt: new Date("2026-08-17T12:00:00.000Z"),
    ...overrides,
  };
}

function message(overrides: Partial<MessageRow> & Pick<MessageRow, "id" | "conversationId" | "role" | "content">): MessageRow {
  return {
    createdAt: new Date("2026-08-17T11:00:00.000Z"),
    ...overrides,
  };
}

describe("truncatePreview", () => {
  it("collapses whitespace and truncates long questions", () => {
    expect(truncatePreview("  What  is   the refund policy?  ")).toBe("What is the refund policy?");
    expect(truncatePreview("x".repeat(90))).toBe(`${"x".repeat(79)}…`);
  });
});

describe("conversationVisitorLabel", () => {
  it("labels playground chats without exposing the visitor token", () => {
    expect(conversationVisitorLabel("playground", "visitor-token-abcdef")).toBe("Playground");
  });

  it("shows the last six characters of a widget visitor token", () => {
    expect(conversationVisitorLabel("widget", "visitor-token-abcdef")).toBe("…abcdef");
  });
});

describe("buildConversationListItems", () => {
  it("uses the last user question and last assistant outcome for each row", () => {
    const items = buildConversationListItems(
      [conversation({ id: "c1", source: "widget", visitorId: "visitor-token-abcdef" })],
      [
        message({
          id: "m1",
          conversationId: "c1",
          role: "user",
          content: "First question about hours",
          createdAt: new Date("2026-08-17T11:00:00.000Z"),
        }),
        message({
          id: "m2",
          conversationId: "c1",
          role: "assistant",
          content: "We open at 9.",
          outcome: "answered_with_context",
          createdAt: new Date("2026-08-17T11:00:01.000Z"),
        }),
        message({
          id: "m3",
          conversationId: "c1",
          role: "user",
          content: "What is the refund policy?",
          createdAt: new Date("2026-08-17T11:05:00.000Z"),
        }),
        message({
          id: "m4",
          conversationId: "c1",
          role: "assistant",
          content: "I don't have that in my knowledge.",
          outcome: "fallback_no_context",
          createdAt: new Date("2026-08-17T11:05:01.000Z"),
        }),
      ],
    );

    expect(items).toEqual([
      expect.objectContaining({
        id: "c1",
        source: "widget",
        sourceLabel: "Widget",
        visitorLabel: "…abcdef",
        preview: "What is the refund policy?",
        outcome: "fallback_no_context",
        messageCount: 4,
      }),
    ]);
  });

  it("keeps conversations with no messages and preserves list order", () => {
    const newer = conversation({
      id: "c-new",
      source: "api",
      visitorId: null,
      updatedAt: new Date("2026-08-17T13:00:00.000Z"),
    });
    const older = conversation({
      id: "c-old",
      source: "playground",
      visitorId: "ignored",
      updatedAt: new Date("2026-08-16T13:00:00.000Z"),
    });

    const items = buildConversationListItems([newer, older], []);

    expect(items.map((item) => item.id)).toEqual(["c-new", "c-old"]);
    expect(items[0]).toMatchObject({
      preview: "No messages yet",
      outcome: null,
      sourceLabel: "API",
      visitorLabel: "Anonymous",
      messageCount: 0,
    });
    expect(items[1]).toMatchObject({
      visitorLabel: "Playground",
      sourceLabel: "Playground",
    });
  });
});

describe("groupConversationsByDay", () => {
  it("groups rows into Today and Yesterday using the given timezone", () => {
    const now = new Date("2026-08-17T18:00:00.000Z");
    const groups = groupConversationsByDay(
      [
        {
          id: "today",
          source: "widget",
          sourceLabel: "Widget",
          visitorLabel: "…abcdef",
          preview: "Refunds?",
          outcome: "answered_with_context",
          messageCount: 2,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "yesterday",
          source: "playground",
          sourceLabel: "Playground",
          visitorLabel: "Playground",
          preview: "Hours?",
          outcome: "low_confidence",
          messageCount: 2,
          createdAt: new Date("2026-08-16T18:00:00.000Z"),
          updatedAt: new Date("2026-08-16T18:00:00.000Z"),
        },
      ],
      now,
      "UTC",
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["today"]);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(["yesterday"]);
  });
});

describe("toTranscriptMessages", () => {
  it("omits system messages and never exposes debug payloads", () => {
    const transcript = toTranscriptMessages([
      message({
        id: "sys",
        conversationId: "c1",
        role: "system",
        content: "hidden",
      }),
      message({
        id: "u1",
        conversationId: "c1",
        role: "user",
        content: "Refunds?",
      }),
      message({
        id: "a1",
        conversationId: "c1",
        role: "assistant",
        content: "I don't know.",
        outcome: "fallback_no_context",
        sources: [{ documentId: "d1", documentName: "Policy" }],
        debug: { question: "refunds rewritten" },
        feedback: "negative",
        confidence: 0.12,
      }),
    ]);

    expect(transcript.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(transcript[1]).toMatchObject({
      id: "a1",
      role: "assistant",
      content: "I don't know.",
      outcome: "fallback_no_context",
      feedback: "negative",
      confidence: 0.12,
      sources: [{ documentId: "d1", documentName: "Policy" }],
    });
    expect(transcript[1]).not.toHaveProperty("debug");
  });
});

describe("conversation classification and filter", () => {
  it("classifies Text, Voice (turns or a call without transcripts) and Mixed", () => {
    expect(classifyConversation({ textMessageCount: 3, voiceMessageCount: 0, voiceCallCount: 0 })).toBe("text");
    expect(classifyConversation({ textMessageCount: 0, voiceMessageCount: 0, voiceCallCount: 0 })).toBe("text");
    expect(classifyConversation({ textMessageCount: 0, voiceMessageCount: 4, voiceCallCount: 1 })).toBe("voice");
    expect(classifyConversation({ textMessageCount: 0, voiceMessageCount: 0, voiceCallCount: 1 })).toBe("voice");
    expect(classifyConversation({ textMessageCount: 2, voiceMessageCount: 4, voiceCallCount: 2 })).toBe("mixed");
    expect(classifyConversation({ textMessageCount: 2, voiceMessageCount: 0, voiceCallCount: 1 })).toBe("mixed");
  });

  it("the Voice filter includes Mixed; Text means text-only", () => {
    expect(matchesConversationFilter("voice", "voice")).toBe(true);
    expect(matchesConversationFilter("mixed", "voice")).toBe(true);
    expect(matchesConversationFilter("text", "voice")).toBe(false);
    expect(matchesConversationFilter("text", "text")).toBe(true);
    expect(matchesConversationFilter("mixed", "text")).toBe(false);
    for (const kind of ["text", "voice", "mixed"] as const) {
      expect(matchesConversationFilter(kind, "all")).toBe(true);
    }
  });

  it("parses the filter query parameter leniently", () => {
    expect(parseConversationTypeFilter("voice")).toBe("voice");
    expect(parseConversationTypeFilter("text")).toBe("text");
    expect(parseConversationTypeFilter(undefined)).toBe("all");
    expect(parseConversationTypeFilter(["voice"])).toBe("all");
    expect(parseConversationTypeFilter("mixed")).toBe("all");
  });
});
