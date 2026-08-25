import { afterEach, describe, expect, it, vi } from "vitest";

import { clearBurstTracker } from "./checks/bot-heuristics";
import type { PolicyViolation } from "./policy-violation";
import { SecurityPolicy } from "./security-policy";

const env = {
  WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
  WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
  WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0";

function policy(
  securitySettings: {
    allowedDomains?: string[];
    widgetRateLimitPerVisitor?: number | null;
    widgetRateLimitPerAssistant?: number | null;
    requireWidgetSigning?: boolean;
    widgetSigningSecret?: string | null;
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

function requestWithOrigin(origin?: string, userAgent = BROWSER_UA) {
  const headers = new Headers();
  if (origin !== undefined) {
    headers.set("Origin", origin);
  }
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  }
  return new Request("http://localhost:3000/api/v1/chat", { method: "POST", headers });
}

const allowAllRateLimits = async () => null;
const allowAllBots = () => ({ ok: true as const });

describe("SecurityPolicy", () => {
  afterEach(() => clearBurstTracker());

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
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
    );
    expect(violation).toBeNull();
  });

  it("allows a matching Origin", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
    );
    expect(violation).toBeNull();
  });

  it("denies a non-matching Origin", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
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
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
    );
    expect(violation).toBeNull();
  });

  it("denies missing Origin when allowlist is set", async () => {
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin(),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
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
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
    );
    expect(violation).toMatchObject({
      status: 403,
      reason: "origin_missing_or_malformed",
    });
  });

  it("skips domain, rate, and bot checks for playground source", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    const evaluateBot = vi.fn(() => ({ ok: true as const }));
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "playground" },
      { consumeRateLimits, evaluateBot },
    );
    expect(violation).toBeNull();
    expect(consumeRateLimits).not.toHaveBeenCalled();
    expect(evaluateBot).not.toHaveBeenCalled();
  });

  it("runs domain allowlist before rate limits (denied origin does not consume buckets)", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    const evaluateBot = vi.fn(() => ({ ok: true as const }));
    const violation = await policy({ allowedDomains: ["example.com"] }).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "widget", visitorId: "visitor01" },
      { consumeRateLimits, evaluateBot },
    );
    expect(violation?.status).toBe(403);
    expect(consumeRateLimits).not.toHaveBeenCalled();
    expect(evaluateBot).not.toHaveBeenCalled();
  });

  it("applies resolved rate limits after domain passes and before bot checks", async () => {
    const limited: PolicyViolation = {
      status: 429,
      message: "Rate limit exceeded.",
      headers: { "Retry-After": "42" },
      reason: "widget_rate_limit_visitor",
    };
    const consumeRateLimits = vi.fn(async () => limited);
    const evaluateBot = vi.fn(() => ({ ok: true as const }));

    const sec = policy({
      allowedDomains: [],
      widgetRateLimitPerVisitor: 5,
      widgetRateLimitPerAssistant: 50,
    });
    const violation = await sec.enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", visitorId: "visitor01", message: "Hi" },
      { consumeRateLimits, evaluateBot },
    );

    expect(violation).toEqual(limited);
    expect(consumeRateLimits).toHaveBeenCalled();
    expect(evaluateBot).not.toHaveBeenCalled();
  });

  it("falls back to env rate limits when assistant overrides are null", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    await policy({
      widgetRateLimitPerVisitor: null,
      widgetRateLimitPerAssistant: null,
    }).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", visitorId: "visitor01" },
      { consumeRateLimits, evaluateBot: allowAllBots },
    );

    expect(consumeRateLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        perVisitorLimit: 20,
        perAssistantLimit: 120,
      }),
    );
  });

  it("blocks chat sends without a valid visitorId", async () => {
    const violation = await policy({}).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", message: "Hello", visitorId: null },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toMatchObject({
      status: 403,
      message: "Request blocked.",
      reason: "bot_invalid_visitor_id",
    });
  });

  it("blocks chat sends from curl user agents", async () => {
    const violation = await policy({}).enforceWidgetRequest(
      requestWithOrigin("https://example.com", "curl/8.0.1"),
      { source: "widget", message: "Hello", visitorId: "visitor01" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toMatchObject({
      status: 403,
      message: "Request blocked.",
      reason: "bot_suspicious_user_agent",
    });
  });

  it("allows config fetches without visitorId", async () => {
    const violation = await policy({}).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget" },
      { consumeRateLimits: allowAllRateLimits },
    );
    expect(violation).toBeNull();
  });

  it("rejects unsigned chat when requireWidgetSigning is enabled", async () => {
    const violation = await policy({
      requireWidgetSigning: true,
      widgetSigningSecret: "test-secret",
    }).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", message: "Hello", visitorId: "visitor01" },
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots },
    );
    expect(violation).toMatchObject({
      status: 403,
      message: "Request blocked.",
      reason: "widget_signature_missing_or_malformed",
    });
  });

  it("accepts a valid signature when requireWidgetSigning is enabled", async () => {
    const verifySignature = vi.fn(() => ({ ok: true as const }));
    const violation = await SecurityPolicy.fromAssistant(
      {
        id: "asst_internal",
        publicId: "asst_public",
        securitySettings: {
          requireWidgetSigning: true,
          widgetSigningSecret: "test-secret",
        },
      },
      env,
    ).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", message: "Hello", visitorId: "visitor01" },
      { consumeRateLimits: allowAllRateLimits, evaluateBot: allowAllBots, verifySignature },
    );
    expect(violation).toBeNull();
    expect(verifySignature).toHaveBeenCalled();
  });

  it("skips signature verification for the sign endpoint but still runs earlier gates", async () => {
    const consumeRateLimits = vi.fn(async () => null);
    const evaluateBot = vi.fn(() => ({ ok: true as const }));
    const verifySignature = vi.fn(() => ({ ok: false as const, reason: "should_not_run" }));
    const violation = await SecurityPolicy.fromAssistant(
      {
        id: "asst_internal",
        publicId: "asst_public",
        securitySettings: {
          requireWidgetSigning: true,
          widgetSigningSecret: "test-secret",
        },
      },
      env,
    ).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget", visitorId: "visitor01", skipSignatureCheck: true },
      { consumeRateLimits, evaluateBot, verifySignature },
    );
    expect(violation).toBeNull();
    expect(consumeRateLimits).toHaveBeenCalled();
    expect(evaluateBot).toHaveBeenCalled();
    expect(verifySignature).not.toHaveBeenCalled();
  });

  it("still denies the sign path when origin is not allowed", async () => {
    const verifySignature = vi.fn(() => ({ ok: true as const }));
    const violation = await policy({
      allowedDomains: ["allowed.example"],
      requireWidgetSigning: true,
      widgetSigningSecret: "test-secret",
    }).enforceWidgetRequest(
      requestWithOrigin("https://evil.example"),
      { source: "widget", visitorId: "visitor01", skipSignatureCheck: true },
      {
        consumeRateLimits: allowAllRateLimits,
        evaluateBot: allowAllBots,
        verifySignature,
      },
    );
    expect(violation).toMatchObject({ status: 403, reason: "origin_denied:evil.example" });
    expect(verifySignature).not.toHaveBeenCalled();
  });
});
