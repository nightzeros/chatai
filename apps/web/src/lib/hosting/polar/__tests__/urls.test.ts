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
  });

  it("accepts relative paths", () => {
    expect(resolveSameOriginUrl(origin, "/dashboard/usage", fallback)).toBe(
      "https://app.nightzeros.com/dashboard/usage",
    );
  });

  it("rejects off-origin URLs", () => {
    expect(resolveSameOriginUrl(origin, "https://evil.example/phish", fallback)).toBeNull();
  });
});

describe("billing return defaults", () => {
  it("point at the usage dashboard with Polar checkout id placeholder", () => {
    expect(defaultBillingReturnUrl("https://app.example")).toBe(
      "https://app.example/dashboard/usage",
    );
    expect(defaultCheckoutSuccessUrl("https://app.example")).toContain(
      "/dashboard/usage?checkout_id={CHECKOUT_ID}",
    );
  });
});
