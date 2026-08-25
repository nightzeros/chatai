import { describe, expect, it, vi } from "vitest";

import { SecurityPolicy } from "./security-policy";
import type { PolicyViolation } from "./policy-violation";

const env = {
  WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
  WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
  WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
};

function policy(
  securitySettings: {
    allowedDomains?: string[];
    widgetRateLimitPerVisitor?: number | null;
    widgetRateLimitPerAssistant?: number | null;
  } = {},
) {
  return SecurityPolicy.fromAssistant(
    {
      id: "asst_internal",
      publicId: "asst_public",
      securitySettings,
    },
    env,
  );
}

function requestWithOrigin(origin?: string) {
  const headers = new Headers();
  if (origin !== undefined) {
    headers.set("Origin", origin);
  }
  return new Request("http://localhost:3000/api/v1/chat", { method: "POST", headers });
}

const allowAllRateLimits = async () => null;

describe("SecurityPolicy", () => {
  it("builds from assistant settings", () => {
    const sec = policy({ allowedDomains: ["example.com"] });
    expect(sec.assistantId).toBe("asst_internal");
    expect(sec.publicId).toBe("asst_public");
    expect(sec.resolved.allowedDomains).toEqual(["example.com"]);
  });

  it("allows when the allowlist is empty", async () => {
    const violation = await policy({}).enforceWidgetRequest(
      requestWithOrigin("http://evil.com"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toBeNull();
  });

  it("allows a matching Origin", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toBeNull();
  });

  it("denies a non-matching Origin", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toMatchObject({
      status: 403,
      message: "Origin not allowed.",
      reason: "origin_denied:evil.com",
    });
  });

  it("allows localhost when listed", async () => {
    const violation = await policy({ allowedDomains: ["localhost"] }).enforceWidgetRequest(
      requestWithOrigin("http://localhost:5173"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toBeNull();
  });

  it("denies missing Origin when allowlist is set", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin(),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toMatchObject({
      status: 403,
      message: "Origin not allowed.",
      reason: "origin_missing_or_malformed",
    });
  });

  it("denies malformed Origin when allowlist is set", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("not-a-url"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toMatchObject({
      status: 403,
      reason: "origin_missing_or_malformed",
    });
  });

  it("skips domain and rate checks for playground source", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "playground" },
      { consumeRateLimits },
    );
    expect(violation).toBeNull();
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });

  it("runs domain allowlist before rate limits (denied origin does not consume buckets)", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "widget", visitorId: "v1" },
      { consumeRateLimits },
    );
    expect(violation?.status).toBe(403);
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });

  it("applies resolved rate limits after domain passes", async () => {
    const limited: PolicyViolation = {
      status: 429,
      message: "Rate limit exceeded.",
      headers: { "Retry-After": "42" },
      reason: "widget_rate_limit_visitor",
    };
    const consumeRateLimits = vi.fn(async () => limited);

    const sec = policy({
      allowedDomains: [],
      widgetRateLimitPerVisitor: 5,
      widgetRateLimitPerAssistant: 50,
    });
    const violation = await sec.enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", visitorId: "v1" },
      { consumeRateLimits },
    );

    expect(violation).toEqual(limited);
    expect(consumeRateLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: "asst_internal",
        visitorId: "v1",
        perVisitorLimit: 5,
        perAssistantLimit: 50,
      }),
    );
  });

  it("falls back to env rate limits when assistant overrides are null", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    await policy({
      widgetRateLimitPerVisitor: null,
      widgetRateLimitPerAssistant: null,
    }).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", visitorId: "v1" },
      { consumeRateLimits },
    );

    expect(consumeRateLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        perVisitorLimit: 20,
        perAssistantLimit: 120,
      }),
    );
  });
});
