import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: vi.fn() }));

import {
  clientHistorySchema,
  fromClientHistory,
  toHistoryMessages,
  voiceSeedHistory,
  withServerGrounding,
} from "./conversation-history";

describe("shared conversation history", () => {
  it("keeps every user/assistant turn regardless of retrieval, and marks grounded answers", () => {
    expect(
      toHistoryMessages([
        { role: "user", content: "Hi", outcome: null },
        { role: "assistant", content: "Hello!", outcome: "conversational" },
        { role: "user", content: "How many members does Zenith have?", outcome: null },
        { role: "assistant", content: "Zenith has 17 members.", outcome: "answered_with_context" },
        { role: "user", content: "How many did you say?", outcome: null },
        { role: "assistant", content: "17 members.", outcome: "answered_from_history" },
        // Voice turn GPT-Live answered itself.
        { role: "assistant", content: "Sure thing.", outcome: null },
        { role: "assistant", content: "I don't know.", outcome: "fallback_no_context" },
      ]),
    ).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How many members does Zenith have?" },
      { role: "assistant", content: "Zenith has 17 members.", grounded: true },
      { role: "user", content: "How many did you say?" },
      { role: "assistant", content: "17 members.", grounded: true },
      { role: "assistant", content: "Sure thing." },
      { role: "assistant", content: "I don't know." },
    ]);
  });

  it("text after a Voice call grounds on the stored backend answer, not the spoken rendering", () => {
    const backend = "The Pro plan costs $20 per month.";
    const rows = [
      { role: "user", content: "What is the Pro plan?", outcome: null },
      // Voice row: content is the backend answer; the spoken rendering lives in debug only.
      { role: "assistant", content: backend, outcome: "answered_with_context" as const },
    ];
    const history = toHistoryMessages(rows);
    expect(history.at(-1)).toEqual({ role: "assistant", content: backend, grounded: true });

    const client = fromClientHistory([
      { role: "user", content: "What is the Pro plan?" },
      { role: "assistant", content: "Twenty dollars a month, with free lifetime support." },
    ]);
    expect(withServerGrounding(client, history).some((item) => item.grounded)).toBe(false);
  });

  it("tags stored GPT-Live live replies so they are never treated as backend answers", () => {
    expect(
      toHistoryMessages([
        { role: "user", content: "How much did you say?", outcome: null },
        { role: "assistant", content: "Seventy dollars.", outcome: null, answeredBy: "realtime_model" },
      ]),
    ).toEqual([
      { role: "user", content: "How much did you say?" },
      { role: "assistant", content: "Seventy dollars.", liveReply: true },
    ]);
  });

  it("drops error placeholders and non-conversation roles", () => {
    expect(
      toHistoryMessages([
        { role: "system", content: "internal", outcome: null },
        { role: "user", content: "Hi", outcome: null },
        {
          role: "assistant",
          content: "I ran into a problem generating a response. Please try again.",
          outcome: "model_failure",
        },
      ]),
    ).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("never trusts client history as grounded unless the server stored the same answer", () => {
    const client = fromClientHistory([
      { role: "user", content: "How many members?" },
      { role: "assistant", content: "Zenith has 17 members." },
      { role: "assistant", content: "Zenith has 900 members." },
    ]);
    expect(client.some((item) => item.grounded)).toBe(false);
    expect(
      withServerGrounding(client, [
        { role: "assistant", content: "Zenith has 17 members.", grounded: true },
      ]),
    ).toEqual([
      { role: "user", content: "How many members?" },
      { role: "assistant", content: "Zenith has 17 members.", clientSupplied: true, grounded: true },
      { role: "assistant", content: "Zenith has 900 members.", clientSupplied: true },
    ]);
  });

  it("seeds GPT-Live with user turns and server-verified assistant turns only", () => {
    const client = withServerGrounding(
      fromClientHistory([
        { role: "user", content: "How many members?" },
        { role: "assistant", content: "Zenith has 17 members." },
        { role: "assistant", content: "Sure, I can also plan your trip." },
      ]),
      [{ role: "assistant", content: "Zenith has 17 members.", grounded: true }],
    );
    expect(voiceSeedHistory(client).map((turn) => turn.content)).toEqual(["How many members?", "Zenith has 17 members."]);
    const stored = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "Hello! How can I help?" },
    ];
    expect(voiceSeedHistory(stored)).toEqual(stored);
  });

  it("bounds client history size", () => {
    const item = { role: "user" as const, content: "x" };
    expect(clientHistorySchema.safeParse(Array(40).fill(item)).success).toBe(true);
    expect(clientHistorySchema.safeParse(Array(41).fill(item)).success).toBe(false);
    expect(clientHistorySchema.safeParse([{ role: "user", content: "x".repeat(4001) }]).success).toBe(false);
    expect(clientHistorySchema.safeParse([{ role: "system", content: "x" }]).success).toBe(false);
  });
});
