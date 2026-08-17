import { describe, expect, it } from "vitest";

import { normalizeSourceStartUrl, normalizeWebsiteOriginKey } from "./url";

describe("normalizeSourceStartUrl", () => {
  it("treats trailing-slash variants as the same stored start URL", () => {
    expect(normalizeSourceStartUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeSourceStartUrl("https://example.com")).toBe("https://example.com/");
  });

  it("normalizes hostname casing and default ports", () => {
    expect(normalizeSourceStartUrl("https://EXAMPLE.com:443/")).toBe("https://example.com/");
    expect(normalizeSourceStartUrl("http://example.com:80/")).toBe("http://example.com/");
  });

  it("removes fragments and query strings from stored start URLs", () => {
    expect(normalizeSourceStartUrl("https://example.com/docs?ref=home#section")).toBe(
      "https://example.com/docs",
    );
  });
});

describe("normalizeWebsiteOriginKey", () => {
  it("treats normalized start URL variants as the same origin", () => {
    const variants = [
      "https://example.com",
      "https://example.com/",
      "https://EXAMPLE.com:443/",
      "https://example.com?ref=1",
      "https://example.com#intro",
    ];

    for (const value of variants) {
      expect(normalizeWebsiteOriginKey(value)).toBe("https://example.com");
    }
  });

  it("keeps non-default ports in the origin key", () => {
    expect(normalizeWebsiteOriginKey("https://example.com:8443/docs")).toBe("https://example.com:8443");
  });

  it("treats different paths on the same host as one website source", () => {
    expect(normalizeWebsiteOriginKey("https://example.com/docs")).toBe("https://example.com");
    expect(normalizeWebsiteOriginKey("https://example.com/pricing")).toBe("https://example.com");
  });
});
