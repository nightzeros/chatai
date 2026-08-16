import { env } from "@/lib/env";

export function embeddingConfig() {
  return {
    apiKey: env.AI_API_KEY ?? "",
    baseURL: env.AI_BASE_URL,
    model: env.EMBEDDING_MODEL,
    dimensions: env.EMBEDDING_DIMENSIONS,
  };
}

export function chatConfig() {
  return {
    apiKey: env.AI_API_KEY ?? "",
    baseURL: env.AI_BASE_URL,
    model: env.AI_MODEL,
  };
}
