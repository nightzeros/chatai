import { describe, expect, it, vi } from "vitest";

import { resolveAssistantModels } from "./ai-config";

vi.mock("@/lib/env", () => ({
  env: {
    AI_API_KEY: "openai-key",
    AI_BASE_URL: "https://api.openai.com/v1",
    AI_MODEL: "gpt-4o-mini",
    OPENROUTER_API_KEY: "or-key",
    EMBEDDING_MODEL: "text-embedding-3-small",
    EMBEDDING_DIMENSIONS: 1536,
  },
}));

describe("resolveAssistantModels", () => {
  it("uses instance defaults when modelSettings is empty", () => {
    const models = resolveAssistantModels({});
    expect(models.chat).toMatchObject({
      provider: "openai",
      apiKey: "openai-key",
      model: "gpt-4o-mini",
    });
    expect(models.embedding).toMatchObject({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
  });

  it("applies per-assistant chat overrides", () => {
    const models = resolveAssistantModels({
      modelSettings: {
        chatProvider: "openrouter",
        chatModel: "anthropic/claude-3.5-sonnet",
      },
    });
    expect(models.chat.model).toBe("anthropic/claude-3.5-sonnet");
    expect(models.chat.provider).toBe("openrouter");
  });
});
