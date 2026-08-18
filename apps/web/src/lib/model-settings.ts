import { CHAT_PROVIDERS, EMBEDDING_PROVIDERS } from "@chatai/ai";
import type { ModelSettings } from "@chatai/database";

/** Native output width for models that cannot be truncated to instance dimensions. */
const FIXED_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "text-embedding-ada-002": 1536,
  "embed-english-v3.0": 1024,
  "embed-multilingual-v3.0": 1024,
  "embed-english-light-v3.0": 384,
  "voyage-3": 1024,
  "voyage-3-lite": 512,
  "voyage-code-3": 1024,
  "voyage-2": 1024,
  "voyage-finance-2": 1024,
  "voyage-law-2": 1024,
};

function emptyToUndefined(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function modelSettingsFromFormData(formData: FormData): ModelSettings {
  const chatProvider = emptyToUndefined(formData.get("chatProvider"));
  const chatModel = emptyToUndefined(formData.get("chatModel"));
  const embeddingProvider = emptyToUndefined(formData.get("embeddingProvider"));
  const embeddingModel = emptyToUndefined(formData.get("embeddingModel"));

  const settings: ModelSettings = {};
  if (chatProvider) settings.chatProvider = chatProvider;
  if (chatModel) settings.chatModel = chatModel;
  if (embeddingProvider) settings.embeddingProvider = embeddingProvider;
  if (embeddingModel) settings.embeddingModel = embeddingModel;
  return settings;
}

export function effectiveEmbeddingSettings(
  settings: ModelSettings | null | undefined,
  instance: { provider: string; model: string },
) {
  return {
    provider: settings?.embeddingProvider ?? instance.provider,
    model: settings?.embeddingModel ?? instance.model,
  };
}

export function embeddingSettingsChanged(
  prev: ModelSettings | null | undefined,
  next: ModelSettings,
  instance: { provider: string; model: string },
) {
  const before = effectiveEmbeddingSettings(prev, instance);
  const after = effectiveEmbeddingSettings(next, instance);
  return before.provider !== after.provider || before.model !== after.model;
}

export function validateEmbeddingModelSettings(
  settings: ModelSettings,
  instanceDimensions: number,
  instance: { provider: string; model: string },
): string | null {
  const { provider, model } = effectiveEmbeddingSettings(settings, instance);

  if (!(EMBEDDING_PROVIDERS as readonly string[]).includes(provider)) {
    return `Unknown embedding provider: ${provider}`;
  }

  if (provider === "openai" || provider === "openai-compatible") {
    if (model.startsWith("text-embedding-3-")) {
      const maxDim = model.includes("large") ? 3072 : 1536;
      if (instanceDimensions > maxDim) {
        return `${model} supports at most ${maxDim} dimensions; this instance uses ${instanceDimensions}.`;
      }
      return null;
    }

    const fixed = FIXED_EMBEDDING_DIMENSIONS[model];
    if (fixed !== undefined && fixed !== instanceDimensions) {
      return `${model} outputs ${fixed} dimensions but this instance uses ${instanceDimensions}.`;
    }
    return null;
  }

  const fixed = FIXED_EMBEDDING_DIMENSIONS[model];
  if (fixed === undefined) {
    return `Unknown ${provider} model "${model}". Cannot verify embedding dimensions.`;
  }
  if (fixed !== instanceDimensions) {
    return `${model} outputs ${fixed} dimensions but this instance uses ${instanceDimensions}. Choose an OpenAI embedding model or change EMBEDDING_DIMENSIONS on the server.`;
  }
  return null;
}

export function validateChatModelSettings(settings: ModelSettings): string | null {
  if (settings.chatProvider && !(CHAT_PROVIDERS as readonly string[]).includes(settings.chatProvider)) {
    return `Unknown chat provider: ${settings.chatProvider}`;
  }
  return null;
}
