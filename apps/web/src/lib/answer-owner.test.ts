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
    ).toEqual({ production: "legacy", shadowAgent: false });
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
    ).toEqual({ production: "agent", shadowAgent: false });
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
    ).toEqual({ production: "legacy", shadowAgent: false });
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
    ).toEqual({ production: "legacy", shadowAgent: false });
  });

  it("runs shadow agent alongside legacy production", () => {
    expect(
      resolveTextAnswerOwner({
        answerOwnerText: "shadow_agent",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: true,
        visitorRelease: false,
      }),
    ).toEqual({ production: "legacy", shadowAgent: true });
  });

  it("disables shadow_agent when assistant is not allowlisted", () => {
    expect(
      resolveTextAnswerOwner({
        answerOwnerText: "shadow_agent",
        allowlistAssistantIds: ["allowed"],
        assistantId: "other",
        visitor: false,
        visitorRelease: false,
      }),
    ).toEqual({ production: "legacy", shadowAgent: false });
  });

  it("parses allowlist", () => {
    expect(parseAssistantAllowlist(" a, b , ")).toEqual(["a", "b"]);
  });
});
