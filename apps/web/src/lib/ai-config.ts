import type { ChatConfig, EmbeddingConfig, ProviderEnv } from "@chatai/ai";
import { resolveChatConfigFromEnv, resolveEmbeddingConfigFromEnv } from "@chatai/ai";
import type { ModelSettings } from "@chatai/database";

import { env } from "@/lib/env";

export function providerEnv(): ProviderEnv {
  return {
    AI_PROVIDER: env.AI_PROVIDER,
    AI_API_KEY: env.AI_API_KEY,
    AI_BASE_URL: env.AI_BASE_URL,
    AI_MODEL: env.AI_MODEL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: env.GOOGLE_GENERATIVE_AI_API_KEY,
    OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
    GROQ_API_KEY: env.GROQ_API_KEY,
    AZURE_OPENAI_API_KEY: env.AZURE_OPENAI_API_KEY,
    AZURE_OPENAI_RESOURCE: env.AZURE_OPENAI_RESOURCE,
    OLLAMA_BASE_URL: env.OLLAMA_BASE_URL,
    COHERE_API_KEY: env.COHERE_API_KEY,
    VOYAGE_API_KEY: env.VOYAGE_API_KEY,
    EMBEDDING_PROVIDER: env.EMBEDDING_PROVIDER,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS: env.EMBEDDING_DIMENSIONS,
  };
}

/** Instance-default chat config (no per-assistant overrides). */
export function chatConfig(): ChatConfig {
  const resolved = resolveChatConfigFromEnv(providerEnv());
  return {
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
    model: resolved.model,
  };
}

/** Instance-default embedding config (no per-assistant overrides). */
export function embeddingConfig(): EmbeddingConfig {
  const resolved = resolveEmbeddingConfigFromEnv(providerEnv());
  return {
    provider: resolved.provider,
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
    model: resolved.model,
    dimensions: resolved.dimensions,
  };
}

export function resolveAssistantModels(assistant: { modelSettings?: ModelSettings | null }) {
  const settings = assistant.modelSettings ?? {};
  const chat = resolveChatConfigFromEnv(providerEnv(), {
    provider: settings.chatProvider,
    model: settings.chatModel,
  });
  const embedding = resolveEmbeddingConfigFromEnv(providerEnv(), {
    provider: settings.embeddingProvider,
    model: settings.embeddingModel,
  });

  return {
    chat: {
      provider: chat.provider,
      apiKey: chat.apiKey,
      baseURL: chat.baseURL,
      model: chat.model,
    } satisfies ChatConfig,
    embedding: {
      provider: embedding.provider,
      apiKey: embedding.apiKey,
      baseURL: embedding.baseURL,
      model: embedding.model,
      dimensions: embedding.dimensions,
    } satisfies EmbeddingConfig,
  };
}
