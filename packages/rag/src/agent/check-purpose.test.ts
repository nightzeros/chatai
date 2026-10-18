import { describe, expect, it, vi } from "vitest";

import { buildScopeProfile } from "../answer/scope";

import { applyPurposeDecision, checkPurpose, domainLimitation, parsePurposeJudge } from "./check-purpose";

describe("parsePurposeJudge", () => {
  it("parses structured decisions", () => {
    expect(parsePurposeJudge('{"decision":"out_of_scope","confidence":"high","rationale":"cooking","mixed":true}')).toEqual({
      decision: "out_of_scope",
      confidence: "high",
      rationale: "cooking",
      mixed: true,
    });
  });

  it("defaults invalid output to uncertain", () => {
    expect(parsePurposeJudge("not json").decision).toBe("uncertain");
  });
});

describe("applyPurposeDecision", () => {
  const profile = buildScopeProfile({
    instructions: "Portfolio assistant for Ada.",
    purpose: {
      summary: "Questions about Ada's work and projects",
      represents: "Ada",
      redirect: "I can help with Ada's projects and experience.",
      mode: "focused",
      origin: "owner",
      instructionsHash: null,
      confirmedAt: "2026-01-01",
    },
  });

  it("delivers in-scope answers", () => {
    expect(applyPurposeDecision({ decision: "in_scope", confidence: "high", unavailable: false }, profile)).toEqual({
      action: "deliver",
    });
  });

  it("redirects high-confidence out-of-scope without the invite loop phrasing", () => {
    const action = applyPurposeDecision(
      { decision: "out_of_scope", confidence: "high", unavailable: false },
      profile,
    );
    expect(action.action).toBe("redirect");
    if (action.action === "redirect") {
      expect(action.text).not.toMatch(/feel free to ask/i);
      expect(action.text.length).toBeGreaterThan(0);
    }
  });

  it("limits on uncertain or unavailable judge results without evidence", () => {
    expect(applyPurposeDecision({ decision: "uncertain", confidence: "low", unavailable: false }, profile).action).toBe(
      "limit",
    );
    expect(applyPurposeDecision({ decision: "in_scope", confidence: "high", unavailable: true }, profile).action).toBe(
      "limit",
    );
  });

  it("keeps a verified evidence-backed draft when the judge is uncertain or unavailable", () => {
    expect(
      applyPurposeDecision(
        { decision: "uncertain", confidence: "low", unavailable: false },
        profile,
        { evidenceSupported: true },
      ),
    ).toEqual({ action: "deliver" });
    expect(
      applyPurposeDecision(
        { decision: "out_of_scope", confidence: "low", unavailable: false },
        profile,
        { evidenceSupported: true },
      ),
    ).toEqual({ action: "deliver" });
    expect(
      applyPurposeDecision(
        { decision: "in_scope", confidence: "high", unavailable: true },
        profile,
        { evidenceSupported: true },
      ),
    ).toEqual({ action: "deliver" });
  });

  it("still redirects high-confidence out-of-scope even when evidenceSupported", () => {
    expect(
      applyPurposeDecision(
        { decision: "out_of_scope", confidence: "high", unavailable: false },
        profile,
        { evidenceSupported: true },
      ).action,
    ).toBe("redirect");
  });

  it("domainLimitation avoids feel-free-to-ask", () => {
    expect(domainLimitation(profile)).not.toMatch(/feel free to ask/i);
  });
});

describe("checkPurpose passage titles", () => {
  const profile = buildScopeProfile({
    instructions: "Portfolio assistant for NightZeros.",
    purpose: {
      summary: "Questions about NightZeros work and projects",
      represents: "NightZeros",
      redirect: "I can help with NightZeros projects.",
      mode: "focused",
      origin: "owner",
      instructionsHash: null,
      confirmedAt: "2026-01-01",
    },
  });

  it("includes retrieved titles in the judge prompt so on-topic evidence can stay in_scope", async () => {
    const generate = vi.fn(async (opts: { prompt?: string }) => {
      expect(opts.prompt).toContain("Retrieved passage titles:");
      expect(opts.prompt).toContain("Projects — ChatAI");
      expect(opts.prompt).toContain("About NightZeros");
      return {
        text: '{"decision":"in_scope","confidence":"high","rationale":"project titles serve Purpose"}',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
      };
    });

    const result = await checkPurpose({
      request: "the new project",
      draft: "NightZeros' latest project is ChatAI [1].",
      reason: "server_pre_output",
      profile,
      chat: { provider: "openai", model: "gpt-4o-mini", apiKey: "k", baseURL: "https://api.openai.com/v1" },
      generate,
      passageTitles: ["Projects — ChatAI", "About NightZeros", null],
    });

    expect(result.decision).toBe("in_scope");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("still allows high-confidence out_of_scope for cooking drafts", async () => {
    const generate = vi.fn(async (opts: { prompt?: string }) => {
      expect(opts.prompt).toContain("Cake recipes");
      return {
        text: '{"decision":"out_of_scope","confidence":"high","rationale":"cooking"}',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
      };
    });

    const result = await checkPurpose({
      request: "Help me bake a cake",
      draft: "Here is a cake recipe [1].",
      reason: "server_pre_output",
      profile,
      chat: { provider: "openai", model: "gpt-4o-mini", apiKey: "k", baseURL: "https://api.openai.com/v1" },
      generate,
      passageTitles: ["Cake recipes"],
    });

    expect(result.decision).toBe("out_of_scope");
    expect(result.confidence).toBe("high");
  });
});
