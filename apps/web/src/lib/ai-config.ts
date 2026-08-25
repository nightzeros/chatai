import type { ChatConfig, EmbeddingConfig, ProviderEnv } from "@chatai/ai";
import { resolveChatConfigFromEnv, resolveEmbeddingConfigFromEnv } from "@chatai/ai";
import type { ModelSettings } from "@chatai/database";

import { env } from "@/lib/env";
import {
  getDecryptedProviderSecrets,
  type DecryptedProviderSecrets,
} from "./secrets/provider-secrets";

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

export type ResolveAssistantModelsOptions = {
  /**
   * Inject decrypted secrets (tests). When omitted and `assistant.id` is set,
   * secrets are loaded and decrypted server-side from `assistant_provider_secrets`.
   */
  decryptedSecrets?: DecryptedProviderSecrets;
};

/**
 * Resolve chat + embedding configs for an assistant.
 * Per-assistant API keys are decrypted only here (server-side) and never serialized
 * back to clients. Keys apply when the stored secret's provider matches the resolved provider.
 */
export async function resolveAssistantModels(
  assistant: { id?: string; modelSettings?: ModelSettings | null },
  options: ResolveAssistantModelsOptions = {},
) {
  const settings = assistant.modelSettings ?? {};
  const secrets =
    options.decryptedSecrets ??
    (assistant.id
      ? await getDecryptedProviderSecrets(assistant.id, env)
      : {});

  const chatResolved = resolveChatConfigFromEnv(providerEnv(), {
    provider: settings.chatProvider,
    model: settings.chatModel,
  });
  const embeddingResolved = resolveEmbeddingConfigFromEnv(providerEnv(), {
    provider: settings.embeddingProvider,
    model: settings.embeddingModel,
  });

  const chat: ChatConfig = {
    provider: chatResolved.provider,
    apiKey: chatResolved.apiKey,
    baseURL: chatResolved.baseURL,
    model: chatResolved.model,
  };
  if (secrets.chat && secrets.chat.provider === chat.provider) {
    chat.apiKey = secrets.chat.apiKey;
  }

  const embedding: EmbeddingConfig = {
    provider: embeddingResolved.provider,
    apiKey: embeddingResolved.apiKey,
    baseURL: embeddingResolved.baseURL,
    model: embeddingResolved.model,
    dimensions: embeddingResolved.dimensions,
  };
  if (secrets.embedding && secrets.embedding.provider === embedding.provider) {
    embedding.apiKey = secrets.embedding.apiKey;
  }

  return { chat, embedding };
}
