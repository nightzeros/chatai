import { describe, expect, it } from "vitest";

import { createChatLanguageModel } from "./models";
import {
  resolveChatConfigFromEnv,
  resolveEmbeddingConfigFromEnv,
} from "./resolve";

const env = {
  AI_API_KEY: "openai-key",
  AI_BASE_URL: "https://api.openai.com/v1",
  AI_MODEL: "gpt-4o-mini",
  EMBEDDING_MODEL: "text-embedding-3-small",
  EMBEDDING_DIMENSIONS: 1536,
};

describe("resolveChatConfigFromEnv", () => {
  it("uses instance openai defaults when provider is omitted", () => {
    const config = resolveChatConfigFromEnv(env);
    expect(config).toEqual({
      provider: "openai",
      apiKey: "openai-key",
      baseURL: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
    });
  });

  it("sets OpenRouter base URL from OPENROUTER_API_KEY", () => {
    const config = resolveChatConfigFromEnv(
      { ...env, OPENROUTER_API_KEY: "or-key" },
      { provider: "openrouter", model: "openai/gpt-4o-mini" },
    );
    expect(config.provider).toBe("openrouter");
    expect(config.apiKey).toBe("or-key");
    expect(config.baseURL).toBe("https://openrouter.ai/api/v1");
    expect(config.model).toBe("openai/gpt-4o-mini");
  });

  it("uses Groq OpenAI-compatible base URL", () => {
    const config = resolveChatConfigFromEnv({ ...env, GROQ_API_KEY: "groq-key" }, { provider: "groq" });
    expect(config.baseURL).toBe("https://api.groq.com/openai/v1");
    expect(config.apiKey).toBe("groq-key");
  });

  it("uses Ollama without requiring an API key", () => {
    const config = resolveChatConfigFromEnv({}, { provider: "ollama", model: "llama3.2" });
    expect(config.baseURL).toBe("http://127.0.0.1:11434/v1");
    expect(config.model).toBe("llama3.2");
    expect(config.apiKey.length).toBeGreaterThan(0);
  });

  it("builds Azure resource base URL", () => {
    const config = resolveChatConfigFromEnv(
      { AZURE_OPENAI_API_KEY: "az-key", AZURE_OPENAI_RESOURCE: "my-res" },
      { provider: "azure", model: "gpt-4o" },
    );
    expect(config.baseURL).toBe("https://my-res.openai.azure.com/openai");
    expect(config.apiKey).toBe("az-key");
  });

  it("resolves Anthropic from ANTHROPIC_API_KEY", () => {
    const config = resolveChatConfigFromEnv(
      { ANTHROPIC_API_KEY: "ant-key" },
      { provider: "anthropic", model: "claude-3-5-sonnet-latest" },
    );
    expect(config.provider).toBe("anthropic");
    expect(config.apiKey).toBe("ant-key");
  });

  it("throws when the selected provider has no credentials", () => {
    expect(() => resolveChatConfigFromEnv({}, { provider: "anthropic" })).toThrow(
      /provider anthropic is not configured on this instance/i,
    );
  });

  it("throws for an unknown chat provider", () => {
    expect(() => resolveChatConfigFromEnv(env, { provider: "nope" })).toThrow(/unknown chat provider/i);
  });
});

describe("createChatLanguageModel", () => {
  function providerId(model: ReturnType<typeof createChatLanguageModel>) {
    if (typeof model === "object" && model && "provider" in model) {
      return String(model.provider);
    }
    return String(model);
  }

  it("uses the Anthropic factory when provider is anthropic", () => {
    const model = createChatLanguageModel({
      provider: "anthropic",
      apiKey: "ant-key",
      baseURL: "https://api.anthropic.com",
      model: "claude-3-5-sonnet-latest",
    });
    expect(providerId(model)).toMatch(/anthropic/i);
  });

  it("uses OpenAI-compatible factory for Groq base URL", () => {
    const model = createChatLanguageModel({
      provider: "groq",
      apiKey: "groq-key",
      baseURL: "https://api.groq.com/openai/v1",
      model: "llama-3.1-8b-instant",
    });
    expect(providerId(model)).toMatch(/openai/i);
  });
});

describe("resolveEmbeddingConfigFromEnv", () => {
  it("uses instance openai embedding defaults", () => {
    const config = resolveEmbeddingConfigFromEnv(env);
    expect(config).toEqual({
      provider: "openai",
      apiKey: "openai-key",
      baseURL: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
  });

  it("resolves Cohere embeddings from COHERE_API_KEY", () => {
    const config = resolveEmbeddingConfigFromEnv(
      { ...env, COHERE_API_KEY: "cohere-key" },
      { provider: "cohere", model: "embed-english-v3.0" },
    );
    expect(config.provider).toBe("cohere");
    expect(config.apiKey).toBe("cohere-key");
    expect(config.model).toBe("embed-english-v3.0");
    expect(config.dimensions).toBe(1536);
  });

  it("throws when embedding provider is missing a key", () => {
    expect(() => resolveEmbeddingConfigFromEnv({ EMBEDDING_DIMENSIONS: 1536 }, { provider: "voyage" })).toThrow(
      /provider voyage is not configured on this instance/i,
    );
  });
});
