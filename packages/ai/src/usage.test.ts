import { describe, expect, it } from "vitest";

import {
  asEmbedManyResult,
  asGenerateChatResult,
  emptyProviderUsage,
  mergeProviderUsage,
  normalizeEmbeddingUsage,
  normalizeLanguageModelUsage,
} from "./usage";

describe("normalizeLanguageModelUsage", () => {
  it("maps SDK usage fields including cached input tokens", () => {
    expect(
      normalizeLanguageModelUsage({
        inputTokens: 100,
        outputTokens: 40,
        totalTokens: 140,
        inputTokenDetails: { cacheReadTokens: 25 },
      }),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cachedInputTokens: 25,
      totalTokens: 140,
    });
  });

  it("defaults missing fields to zero", () => {
    expect(normalizeLanguageModelUsage(undefined)).toEqual(emptyProviderUsage());
  });
});

describe("normalizeEmbeddingUsage", () => {
  it("maps embedding token counts into input/total tokens", () => {
    expect(normalizeEmbeddingUsage({ tokens: 512 })).toEqual({
      inputTokens: 512,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 512,
    });
  });
});

describe("mergeProviderUsage", () => {
  it("sums usage across provider sub-calls", () => {
    expect(
      mergeProviderUsage(
        { inputTokens: 10, outputTokens: 2, cachedInputTokens: 1, totalTokens: 12 },
        { inputTokens: 5, outputTokens: 3, cachedInputTokens: 0, totalTokens: 8 },
      ),
    ).toEqual({
      inputTokens: 15,
      outputTokens: 5,
      cachedInputTokens: 1,
      totalTokens: 20,
    });
  });
});

describe("legacy result adapters", () => {
  it("wraps string generateChat mocks", () => {
    expect(asGenerateChatResult('{"ok":true}')).toEqual({
      text: '{"ok":true}',
      usage: emptyProviderUsage(),
    });
  });

  it("wraps matrix embedMany mocks", () => {
    expect(asEmbedManyResult([[0.1, 0.2]])).toEqual({
      embeddings: [[0.1, 0.2]],
      usage: emptyProviderUsage(),
    });
  });
});
