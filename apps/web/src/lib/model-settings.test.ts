import { describe, expect, it } from "vitest";

import {
  embeddingSettingsChanged,
  modelSettingsFromFormData,
  validateChatModelSettings,
  validateEmbeddingModelSettings,
} from "./model-settings";

const instance = { provider: "openai", model: "text-embedding-3-small" };

describe("modelSettingsFromFormData", () => {
  it("omits empty fields", () => {
    const form = new FormData();
    form.set("chatProvider", "openrouter");
    form.set("chatModel", "anthropic/claude-3.5-sonnet");
    form.set("embeddingProvider", "");
    form.set("embeddingModel", "  ");

    expect(modelSettingsFromFormData(form)).toEqual({
      chatProvider: "openrouter",
      chatModel: "anthropic/claude-3.5-sonnet",
    });
  });
});

describe("validateEmbeddingModelSettings", () => {
  it("accepts openai text-embedding-3-small at 1536", () => {
    expect(validateEmbeddingModelSettings({}, 1536, instance)).toBeNull();
  });

  it("rejects cohere embed-english-v3.0 when instance is 1536", () => {
    const message = validateEmbeddingModelSettings(
      { embeddingProvider: "cohere", embeddingModel: "embed-english-v3.0" },
      1536,
      instance,
    );
    expect(message).toMatch(/1024 dimensions/i);
  });

  it("accepts cohere when instance dimensions match", () => {
    expect(
      validateEmbeddingModelSettings(
        { embeddingProvider: "cohere", embeddingModel: "embed-english-v3.0" },
        1024,
        instance,
      ),
    ).toBeNull();
  });

  it("rejects unknown voyage models", () => {
    expect(
      validateEmbeddingModelSettings(
        { embeddingProvider: "voyage", embeddingModel: "unknown-model" },
        1536,
        instance,
      ),
    ).toMatch(/cannot verify embedding dimensions/i);
  });
});

describe("embeddingSettingsChanged", () => {
  it("detects embedding model override changes", () => {
    expect(
      embeddingSettingsChanged(
        { embeddingModel: "text-embedding-3-large" },
        { embeddingModel: "text-embedding-3-small" },
        instance,
      ),
    ).toBe(true);
  });

  it("is false when effective settings are unchanged", () => {
    expect(embeddingSettingsChanged({}, {}, instance)).toBe(false);
  });
});

describe("validateChatModelSettings", () => {
  it("rejects unknown chat providers", () => {
    expect(validateChatModelSettings({ chatProvider: "nope" })).toMatch(/unknown chat provider/i);
  });
});
