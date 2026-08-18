import { embedMany as sdkEmbedMany } from "ai";

import { createEmbeddingModel } from "./models";

const BATCH_SIZE = 100;

export type EmbeddingConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  dimensions: number;
  provider?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedMany(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  if (!config.apiKey) {
    throw new Error("AI_API_KEY is required to generate embeddings.");
  }

  if (texts.length === 0) {
    return [];
  }

  const openaiCompatible = !config.provider || config.provider === "openai" || config.provider === "openai-compatible";
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let lastError: unknown;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await sdkEmbedMany({
          model: createEmbeddingModel(config),
          values: batch,
          maxRetries: 2,
          ...(openaiCompatible
            ? {
                providerOptions: {
                  openai: { dimensions: config.dimensions },
                },
              }
            : {}),
        });
        embeddings.push(...result.embeddings);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        await sleep(250 * 2 ** attempt);
      }
    }

    if (lastError) {
      throw lastError instanceof Error ? lastError : new Error("Embedding request failed.");
    }
  }

  return embeddings;
}
