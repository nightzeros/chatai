import { createAnthropic } from "@ai-sdk/anthropic";
import { createCohere } from "@ai-sdk/cohere";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createVoyage } from "@ai-sdk/voyage";
import type { EmbeddingModel, LanguageModel } from "ai";

import type { ChatConfig } from "./chat";
import type { EmbeddingConfig } from "./embeddings";

export function createChatLanguageModel(config: ChatConfig): LanguageModel {
  const provider = config.provider ?? "openai";

  if (provider === "anthropic") {
    return createAnthropic({ apiKey: config.apiKey }).languageModel(config.model);
  }

  if (provider === "google") {
    return createGoogleGenerativeAI({ apiKey: config.apiKey }).languageModel(config.model);
  }

  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  }).chat(config.model);
}

export function createEmbeddingModel(config: EmbeddingConfig): EmbeddingModel {
  const provider = config.provider ?? "openai";

  if (provider === "cohere") {
    return createCohere({ apiKey: config.apiKey }).textEmbeddingModel(config.model);
  }

  if (provider === "voyage") {
    return createVoyage({ apiKey: config.apiKey }).textEmbeddingModel(config.model);
  }

  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  }).embedding(config.model);
}
