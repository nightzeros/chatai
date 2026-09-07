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
  it("uses instance defaults when modelSettings is empty", async () => {
    const models = await resolveAssistantModels({});
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
    expect(models.billing.chat).toBe("hosted");
    expect(models.billing.embedding).toBe("hosted");
  });

  it("applies per-assistant chat overrides", async () => {
    const models = await resolveAssistantModels({
      modelSettings: {
        chatProvider: "openrouter",
        chatModel: "anthropic/claude-3.5-sonnet",
      },
    });
    expect(models.chat.model).toBe("anthropic/claude-3.5-sonnet");
    expect(models.chat.provider).toBe("openrouter");
  });

  it("uses decrypted per-assistant keys when provider matches", async () => {
    const models = await resolveAssistantModels(
      {
        id: "asst-1",
        modelSettings: { chatProvider: "openai", embeddingProvider: "openai" },
      },
      {
        decryptedSecrets: {
          chat: { kind: "chat", provider: "openai", apiKey: "asst-chat-key" },
          embedding: { kind: "embedding", provider: "openai", apiKey: "asst-embed-key" },
        },
      },
    );
    expect(models.chat.apiKey).toBe("asst-chat-key");
    expect(models.embedding.apiKey).toBe("asst-embed-key");
    expect(models.billing).toEqual({
      chat: "byok",
      embedding: "byok",
      rerank: "hosted",
    });
  });

  it("ignores decrypted keys when provider does not match", async () => {
    const models = await resolveAssistantModels(
      {
        modelSettings: { chatProvider: "openrouter" },
      },
      {
        decryptedSecrets: {
          chat: { kind: "chat", provider: "openai", apiKey: "asst-chat-key" },
        },
      },
    );
    expect(models.chat.apiKey).toBe("or-key");
  });
});
