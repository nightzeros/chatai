import { describe, expect, it } from "vitest";

import { createUsageLedger } from "./usage-ledger";

const usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 };

describe("createUsageLedger", () => {
  it("dedupes by eventId and accepts multiple distinct late records", () => {
    const ledger = createUsageLedger();
    expect(
      ledger.record({
        kind: "embedding",
        usage,
        step: "search_knowledge_embed",
        eventId: "e1",
      }),
    ).toBe(true);
    expect(
      ledger.record({
        kind: "embedding",
        usage,
        step: "search_knowledge_embed",
        eventId: "e1",
      }),
    ).toBe(false);

    expect(
      ledger.recordLate([
        { kind: "chat_completion", usage, step: "agent_step_1", eventId: "c1" },
        { kind: "chat_completion", usage, step: "agent_step_1", eventId: "c1" },
        { kind: "chat_completion", usage, step: "agent_step_2", eventId: "c2" },
      ]),
    ).toBe(2);

    expect(ledger.records().map((record) => record.eventId)).toEqual(["e1", "c1", "c2"]);
  });
});
