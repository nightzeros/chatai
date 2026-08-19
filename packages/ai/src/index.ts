export { embedMany, type EmbeddingConfig } from "./embeddings";
export { generateChat, streamChat, type ChatConfig, type ChatMessage } from "./chat";
export {
  CHAT_PROVIDERS,
  EMBEDDING_PROVIDERS,
  resolveChatConfigFromEnv,
  resolveEmbeddingConfigFromEnv,
} from "./resolve";
export type {
  ChatProviderId,
  EmbeddingProviderId,
  ProviderEnv,
  ResolvedChatConfig,
  ResolvedEmbeddingConfig,
} from "./resolve";
export { createChatLanguageModel, createEmbeddingModel } from "./models";
