import { describe, expect, it } from "vitest";

import {
  parseAssistantAllowlist,
  resolveTextAnswerOwner,
  resolveVoiceAnswerOwner,
} from "./answer-owner";

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

describe("resolveVoiceAnswerOwner", () => {
  it("defaults to legacy independently of text", () => {
    expect(
      resolveVoiceAnswerOwner({
        answerOwnerVoice: "legacy",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: false,
        visitorRelease: true,
      }),
    ).toEqual({ production: "legacy", shadowAgent: false });
  });

  it("allows playground voice agent when flag is agent", () => {
    expect(
      resolveVoiceAnswerOwner({
        answerOwnerVoice: "agent",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: false,
        visitorRelease: false,
      }),
    ).toEqual({ production: "agent", shadowAgent: false });
  });

  it("keeps widget visitors on legacy until voice visitor release", () => {
    expect(
      resolveVoiceAnswerOwner({
        answerOwnerVoice: "agent",
        allowlistAssistantIds: [],
        assistantId: "a1",
        visitor: true,
        visitorRelease: false,
      }),
    ).toEqual({ production: "legacy", shadowAgent: false });
  });
});
