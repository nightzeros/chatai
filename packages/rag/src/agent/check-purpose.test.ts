import { describe, expect, it } from "vitest";

import { buildScopeProfile } from "../answer/scope";

import { applyPurposeDecision, domainLimitation, parsePurposeJudge } from "./check-purpose";

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

  it("limits on uncertain or unavailable judge results", () => {
    expect(applyPurposeDecision({ decision: "uncertain", confidence: "low", unavailable: false }, profile).action).toBe(
      "limit",
    );
    expect(applyPurposeDecision({ decision: "in_scope", confidence: "high", unavailable: true }, profile).action).toBe(
      "limit",
    );
  });

  it("domainLimitation avoids feel-free-to-ask", () => {
    expect(domainLimitation(profile)).not.toMatch(/feel free to ask/i);
  });
});
