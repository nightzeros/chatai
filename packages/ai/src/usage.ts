export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
};

export function emptyProviderUsage(): ProviderUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  };
}

/** Normalize Vercel AI SDK language-model usage into our ledger shape. */
export function normalizeLanguageModelUsage(usage: {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined;
  };
} | null | undefined): ProviderUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cachedInputTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
  const totalTokens = usage?.totalTokens ?? inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
  };
}

/** Normalize Vercel AI SDK embedding usage into our ledger shape. */
export function normalizeEmbeddingUsage(
  usage: { tokens?: number } | null | undefined,
): ProviderUsage {
  const totalTokens = usage?.tokens ?? 0;
  return {
    inputTokens: totalTokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    totalTokens,
  };
}

export function mergeProviderUsage(...parts: ProviderUsage[]): ProviderUsage {
  return parts.reduce<ProviderUsage>(
    (acc, part) => ({
      inputTokens: acc.inputTokens + part.inputTokens,
      outputTokens: acc.outputTokens + part.outputTokens,
      cachedInputTokens: acc.cachedInputTokens + part.cachedInputTokens,
      totalTokens: acc.totalTokens + part.totalTokens,
    }),
    emptyProviderUsage(),
  );
}

export type GenerateChatResult = {
  text: string;
  usage: ProviderUsage;
};

/** Accept either the new result object or a legacy string (test mocks). */
export function asGenerateChatResult(result: GenerateChatResult | string): GenerateChatResult {
  if (typeof result === "string") {
    return { text: result.trim(), usage: emptyProviderUsage() };
  }
  return {
    text: result.text.trim(),
    usage: result.usage ?? emptyProviderUsage(),
  };
}

export type EmbedManyResult = {
  embeddings: number[][];
  usage: ProviderUsage;
};

/** Accept either the new result object or a legacy embedding matrix (test mocks). */
export function asEmbedManyResult(result: EmbedManyResult | number[][]): EmbedManyResult {
  if (Array.isArray(result)) {
    return { embeddings: result, usage: emptyProviderUsage() };
  }
  return {
    embeddings: result.embeddings,
    usage: result.usage ?? emptyProviderUsage(),
  };
}
