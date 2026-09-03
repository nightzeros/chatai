import { describe, expect, it } from "vitest";

import { resolveBillingMode } from "./billing-mode";

describe("resolveBillingMode", () => {
  it("defaults to hosted when no assistant secrets apply", () => {
    expect(
      resolveBillingMode({ kind: "chat", provider: "openai", secrets: {} }),
    ).toBe("hosted");
  });

  it("marks chat as byok when a matching assistant secret is present", () => {
    expect(
      resolveBillingMode({
        kind: "chat",
        provider: "openai",
        secrets: {
          chat: { kind: "chat", provider: "openai", apiKey: "sk-asst" },
        },
      }),
    ).toBe("byok");
  });

  it("keeps chat hosted when secret provider does not match", () => {
    expect(
      resolveBillingMode({
        kind: "chat",
        provider: "openrouter",
        secrets: {
          chat: { kind: "chat", provider: "openai", apiKey: "sk-asst" },
        },
      }),
    ).toBe("hosted");
  });

  it("marks embedding as byok when matching secret is present", () => {
    expect(
      resolveBillingMode({
        kind: "embedding",
        provider: "openai",
        secrets: {
          embedding: { kind: "embedding", provider: "openai", apiKey: "sk-emb" },
        },
      }),
    ).toBe("byok");
  });

  it("always treats cohere rerank as hosted", () => {
    expect(
      resolveBillingMode({
        kind: "rerank",
        provider: "cohere",
        secrets: {
          chat: { kind: "chat", provider: "cohere", apiKey: "x" },
        },
      }),
    ).toBe("hosted");
  });
});
