import { describe, expect, it } from "vitest";

import { parseAssistantAllowlist, resolveTextAnswerOwner } from "./answer-owner";

describe("resolveTextAnswerOwner", () => {
  it("defaults to legacy", () => {
    expect(
      resolveTextAnswerOwner({
        answerOwnerText: "legacy",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: false,
        visitorRelease: false,
      }),
    ).toBe("legacy");
  });

  it("allows playground agent when flag is agent", () => {
    expect(
      resolveTextAnswerOwner({
        answerOwnerText: "agent",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: false,
        visitorRelease: false,
      }),
    ).toBe("agent");
  });

  it("keeps visitors on legacy until visitor release", () => {
    expect(
      resolveTextAnswerOwner({
        answerOwnerText: "agent",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: true,
        visitorRelease: false,
      }),
    ).toBe("legacy");
  });

  it("respects assistant allowlist", () => {
    expect(
      resolveTextAnswerOwner({
        answerOwnerText: "agent",
        allowlistAssistantIds: ["allowed"],
        assistantId: "other",
        visitor: false,
        visitorRelease: false,
      }),
    ).toBe("legacy");
  });

  it("parses allowlist", () => {
    expect(parseAssistantAllowlist(" a, b , ")).toEqual(["a", "b"]);
  });
});
