import { describe, expect, it } from "vitest";

import {
  defaultBillingReturnUrl,
  defaultCheckoutSuccessUrl,
  resolveSameOriginUrl,
} from "../urls";

describe("resolveSameOriginUrl", () => {
  const origin = "https://app.nightzeros.com";
  const fallback = "https://app.nightzeros.com/dashboard/usage";

  it("uses the fallback when candidate is missing", () => {
    expect(resolveSameOriginUrl(origin, undefined, fallback)).toBe(fallback);
    expect(resolveSameOriginUrl(origin, "", fallback)).toBe(fallback);
  });

  it("accepts same-origin absolute URLs", () => {
    expect(
      resolveSameOriginUrl(origin, "https://app.nightzeros.com/dashboard/usage", fallback),
    ).toBe("https://app.nightzeros.com/dashboard/usage");
  });

  it("accepts relative paths", () => {
    expect(resolveSameOriginUrl(origin, "/dashboard/usage", fallback)).toBe(
      "https://app.nightzeros.com/dashboard/usage",
    );
  });

  it("rejects off-origin URLs", () => {
    expect(resolveSameOriginUrl(origin, "https://evil.example/phish", fallback)).toBeNull();
  });

  it("rejects protocol-relative and javascript URLs", () => {
    expect(resolveSameOriginUrl(origin, "//evil.example/phish", fallback)).toBeNull();
    expect(resolveSameOriginUrl(origin, "javascript:alert(1)", fallback)).toBeNull();
  });
});

describe("billing return defaults", () => {
  it("point at the usage dashboard, not a missing settings page", () => {
    expect(defaultBillingReturnUrl("https://app.example")).toBe(
      "https://app.example/dashboard/usage",
    );
    expect(defaultCheckoutSuccessUrl("https://app.example")).toContain(
      "/dashboard/usage?session_id={CHECKOUT_SESSION_ID}",
    );
  });
});
