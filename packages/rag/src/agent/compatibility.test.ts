import { describe, expect, it } from "vitest";

import { assertAgentCompatible } from "./compatibility";

describe("assertAgentCompatible", () => {
  it("accepts openai tool-calling providers", () => {
    expect(
      assertAgentCompatible({
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "k",
        baseURL: "https://api.openai.com/v1",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects ollama without silent fallback", () => {
    const result = assertAgentCompatible({
      provider: "ollama",
      model: "llama3",
      apiKey: "ollama",
      baseURL: "http://localhost:11434",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("agent_model_incompatible");
  });
});
