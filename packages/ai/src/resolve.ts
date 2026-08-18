export type ProviderEnv = {
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;
  AZURE_OPENAI_API_KEY?: string;
  AZURE_OPENAI_RESOURCE?: string;
  OLLAMA_BASE_URL?: string;
  COHERE_API_KEY?: string;
  VOYAGE_API_KEY?: string;
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: number;
};

export const CHAT_PROVIDERS = [
  "openai",
  "openai-compatible",
  "anthropic",
  "google",
  "openrouter",
  "azure",
  "ollama",
  "groq",
] as const;

export const EMBEDDING_PROVIDERS = ["openai", "openai-compatible", "cohere", "voyage"] as const;

export type ChatProviderId = (typeof CHAT_PROVIDERS)[number];
export type EmbeddingProviderId = (typeof EMBEDDING_PROVIDERS)[number];

export type ResolvedChatConfig = {
  provider: ChatProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
};

export type ResolvedEmbeddingConfig = {
  provider: EmbeddingProviderId;
  apiKey: string;
  baseURL: string;
  model: string;
  dimensions: number;
};

function notConfigured(provider: string): never {
  throw new Error(`provider ${provider} is not configured on this instance`);
}

function isChatProvider(value: string): value is ChatProviderId {
  return (CHAT_PROVIDERS as readonly string[]).includes(value);
}

function isEmbeddingProvider(value: string): value is EmbeddingProviderId {
  return (EMBEDDING_PROVIDERS as readonly string[]).includes(value);
}

function requireKey(provider: string, key: string | undefined): string {
  if (!key?.trim()) notConfigured(provider);
  return key;
}

export function resolveChatConfigFromEnv(
  env: ProviderEnv,
  override?: { provider?: string; model?: string },
): ResolvedChatConfig {
  const providerName = override?.provider ?? env.AI_PROVIDER ?? "openai";
  if (!isChatProvider(providerName)) {
    throw new Error(`Unknown chat provider: ${providerName}`);
  }

  const model = override?.model ?? env.AI_MODEL ?? "gpt-4o-mini";

  switch (providerName) {
    case "openai":
    case "openai-compatible":
      return {
        provider: providerName,
        apiKey: requireKey(providerName, env.AI_API_KEY),
        baseURL: env.AI_BASE_URL ?? "https://api.openai.com/v1",
        model,
      };
    case "openrouter":
      return {
        provider: "openrouter",
        apiKey: requireKey("openrouter", env.OPENROUTER_API_KEY),
        baseURL: "https://openrouter.ai/api/v1",
        model,
      };
    case "groq":
      return {
        provider: "groq",
        apiKey: requireKey("groq", env.GROQ_API_KEY),
        baseURL: "https://api.groq.com/openai/v1",
        model,
      };
    case "azure": {
      const resource = env.AZURE_OPENAI_RESOURCE?.trim();
      if (!resource) notConfigured("azure");
      return {
        provider: "azure",
        apiKey: requireKey("azure", env.AZURE_OPENAI_API_KEY),
        baseURL: `https://${resource}.openai.azure.com/openai`,
        model,
      };
    }
    case "ollama":
      return {
        provider: "ollama",
        apiKey: env.AI_API_KEY?.trim() || "ollama",
        baseURL: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
        model,
      };
    case "anthropic":
      return {
        provider: "anthropic",
        apiKey: requireKey("anthropic", env.ANTHROPIC_API_KEY),
        baseURL: "https://api.anthropic.com",
        model,
      };
    case "google":
      return {
        provider: "google",
        apiKey: requireKey("google", env.GOOGLE_GENERATIVE_AI_API_KEY),
        baseURL: "https://generativelanguage.googleapis.com",
        model,
      };
  }
}

export function resolveEmbeddingConfigFromEnv(
  env: ProviderEnv,
  override?: { provider?: string; model?: string; dimensions?: number },
): ResolvedEmbeddingConfig {
  const providerName = override?.provider ?? env.EMBEDDING_PROVIDER ?? "openai";
  if (!isEmbeddingProvider(providerName)) {
    throw new Error(`Unknown embedding provider: ${providerName}`);
  }

  const model = override?.model ?? env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const dimensions = override?.dimensions ?? env.EMBEDDING_DIMENSIONS ?? 1536;
  const openaiBase = env.AI_BASE_URL ?? "https://api.openai.com/v1";

  switch (providerName) {
    case "openai":
    case "openai-compatible":
      return {
        provider: providerName,
        apiKey: requireKey(providerName, env.AI_API_KEY),
        baseURL: openaiBase,
        model,
        dimensions,
      };
    case "cohere":
      return {
        provider: "cohere",
        apiKey: requireKey("cohere", env.COHERE_API_KEY),
        baseURL: "https://api.cohere.com",
        model,
        dimensions,
      };
    case "voyage":
      return {
        provider: "voyage",
        apiKey: requireKey("voyage", env.VOYAGE_API_KEY),
        baseURL: "https://api.voyageai.com/v1",
        model,
        dimensions,
      };
  }
}
