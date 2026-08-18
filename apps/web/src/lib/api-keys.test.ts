import { describe, expect, it } from "vitest";

import { generateApiKeySecret, hashApiKey, parseBearerToken, usesApiKeyAuth } from "./api-keys";

describe("api-keys", () => {
  it("hashes secrets deterministically", () => {
    expect(hashApiKey("sk_live_test")).toHaveLength(64);
    expect(hashApiKey("sk_live_test")).toBe(hashApiKey("sk_live_test"));
  });

  it("generates sk_live secrets with display prefix", () => {
    const { secret, prefix } = generateApiKeySecret();
    expect(secret.startsWith("sk_live_")).toBe(true);
    expect(prefix).toBe(secret.slice(0, 12));
  });

  it("parses bearer tokens", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer sk_live_abc123" },
    });
    expect(parseBearerToken(request)).toBe("sk_live_abc123");
    expect(parseBearerToken(new Request("https://example.com"))).toBeNull();
  });

  it("treats sk_ bearer as API-key auth and leaves widget requests keyless", () => {
    expect(
      usesApiKeyAuth(
        new Request("https://example.com", { headers: { Authorization: "Bearer sk_live_abc" } }),
      ),
    ).toBe(true);
    expect(usesApiKeyAuth(new Request("https://example.com"))).toBe(false);
    expect(
      usesApiKeyAuth(
        new Request("https://example.com", { headers: { Authorization: "Bearer other" } }),
      ),
    ).toBe(false);
  });
});
