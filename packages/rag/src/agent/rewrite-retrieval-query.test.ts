import { describe, expect, it, vi } from "vitest";

import { buildScopeProfile } from "../answer/scope";

import { parseRewriteQuery, rewriteRetrievalQuery } from "./rewrite-retrieval-query";

const chat = { provider: "openai", model: "gpt-4o-mini", apiKey: "k", baseURL: "https://api.openai.com/v1" };

const nightZerosProfile = buildScopeProfile({
  assistantName: "NightZeros",
  instructions: "Answers questions about NightZeros.",
  purpose: {
    summary: "Questions about NightZeros, their products, and projects including ChatAI.",
    represents: "NightZeros",
    redirect: "I can help with NightZeros and their projects.",
    mode: "focused",
    origin: "owner",
    instructionsHash: null,
    confirmedAt: "2026-01-01",
  },
});

describe("parseRewriteQuery", () => {
  it("parses JSON query payloads", () => {
    expect(parseRewriteQuery('{"query":"NightZeros latest project"}')).toBe("NightZeros latest project");
  });

  it("rejects empty or invalid JSON", () => {
    expect(parseRewriteQuery("")).toBeNull();
    expect(parseRewriteQuery("{nope}")).toBeNull();
  });
});

describe("rewriteRetrievalQuery", () => {
  it("rewrites pronoun/incomplete asks using Purpose subject", async () => {
    const generate = vi.fn(async () => ({
      text: '{"query":"NightZeros latest project ChatAI"}',
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
    }));

    const result = await rewriteRetrievalQuery({
      message: "what's their latest",
      history: [
        { role: "assistant", content: "I can help with NightZeros and their work." },
        { role: "user", content: "tell me about them" },
      ],
      chat,
      profile: nightZerosProfile,
      generate,
    });

    expect(result.rawQuery).toBe("what's their latest");
    expect(result.rewritten).toBe(true);
    expect(result.query.toLowerCase()).toMatch(/nightzeros/);
    expect(result.query.toLowerCase()).toMatch(/project|latest|chatai/);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("falls back to the original message on failure", async () => {
    const generate = vi.fn(async () => {
      throw new Error("unavailable");
    });

    const result = await rewriteRetrievalQuery({
      message: "what's their latest",
      history: [],
      chat,
      profile: nightZerosProfile,
      generate,
    });

    expect(result).toMatchObject({
      query: "what's their latest",
      rawQuery: "what's their latest",
      rewritten: false,
    });
  });

  it("falls back when the model returns empty query JSON", async () => {
    const generate = vi.fn(async () => ({
      text: '{"query":""}',
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, totalTokens: 2 },
    }));

    const result = await rewriteRetrievalQuery({
      message: "the new project",
      history: [],
      chat,
      profile: nightZerosProfile,
      generate,
    });

    expect(result.query).toBe("the new project");
    expect(result.rewritten).toBe(false);
  });
});
