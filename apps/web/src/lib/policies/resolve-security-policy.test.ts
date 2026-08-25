import { describe, expect, it } from "vitest";

import { resolveSecurityPolicy } from "./resolve-security-policy";

const env = {
  WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
  WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
  WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
};

describe("resolveSecurityPolicy", () => {
  it("applies defaults and env rate-limit fallbacks", () => {
    const resolved = resolveSecurityPolicy(null, env);
    expect(resolved.allowedDomains).toEqual([]);
    expect(resolved.requireWidgetSigning).toBe(false);
    expect(resolved.widgetSigningSecret).toBeNull();
    expect(resolved.widgetRateLimitPerVisitor).toBe(20);
    expect(resolved.widgetRateLimitPerAssistant).toBe(120);
    expect(resolved.signingMaxSkewSeconds).toBe(300);
  });

  it("uses per-assistant rate limit overrides when set", () => {
    const resolved = resolveSecurityPolicy(
      {
        allowedDomains: ["example.com"],
        requireWidgetSigning: true,
        widgetRateLimitPerVisitor: 5,
        widgetRateLimitPerAssistant: 50,
      },
      env,
    );
    expect(resolved.allowedDomains).toEqual(["example.com"]);
    expect(resolved.requireWidgetSigning).toBe(true);
    expect(resolved.widgetRateLimitPerVisitor).toBe(5);
    expect(resolved.widgetRateLimitPerAssistant).toBe(50);
  });
});
