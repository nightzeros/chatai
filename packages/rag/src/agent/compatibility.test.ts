import { describe, expect, it } from "vitest";

import { assertAgentCompatible } from "./compatibility";

const base = { apiKey: "k", baseURL: "https://example.com/v1", model: "test-model" };

describe("assertAgentCompatible", () => {
  it.each(["openai", "openai-compatible", "anthropic", "google", "openrouter", "groq", "azure"])(
    "accepts tool-calling provider %s",
    (provider) => {
      expect(assertAgentCompatible({ ...base, provider })).toEqual({ ok: true });
    },
  );

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

  it("rejects an empty model id", () => {
    const result = assertAgentCompatible({ ...base, provider: "openai", model: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("agent_model_incompatible");
  });

  it("defaults missing provider to openai", () => {
    expect(assertAgentCompatible({ ...base, provider: undefined })).toEqual({ ok: true });
  });
});
