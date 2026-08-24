import { describe, expect, it } from "vitest";

import { SecurityPolicy } from "./security-policy";

const env = {
  WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
  WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
  WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
};

function policy(allowedDomains: string[] = []) {
  return SecurityPolicy.fromAssistant(
    {
      id: "asst_internal",
      publicId: "asst_public",
      securitySettings: { allowedDomains },
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

describe("SecurityPolicy", () => {
  it("builds from assistant settings", () => {
    const sec = policy(["example.com"]);
    expect(sec.assistantId).toBe("asst_internal");
    expect(sec.publicId).toBe("asst_public");
    expect(sec.resolved.allowedDomains).toEqual(["example.com"]);
  });

  it("allows when the allowlist is empty", async () => {
    const violation = await policy([]).enforceWidgetRequest(requestWithOrigin("http://evil.com"), {
      source: "widget",
    });
    expect(violation).toBeNull();
  });

  it("allows a matching Origin", async () => {
    const violation = await policy(["example.com"]).enforceWidgetRequest(
      requestWithOrigin("https://example.com"),
      { source: "widget" },
    );
    expect(violation).toBeNull();
  });

  it("denies a non-matching Origin", async () => {
    const violation = await policy(["example.com"]).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "widget" },
    );
    expect(violation).toMatchObject({
      status: 403,
      message: "Origin not allowed.",
      reason: "origin_denied:evil.com",
    });
  });

  it("allows localhost when listed", async () => {
    const violation = await policy(["localhost"]).enforceWidgetRequest(
      requestWithOrigin("http://localhost:5173"),
      { source: "widget" },
    );
    expect(violation).toBeNull();
  });

  it("denies missing Origin when allowlist is set", async () => {
    const violation = await policy(["example.com"]).enforceWidgetRequest(requestWithOrigin(), {
      source: "widget",
    });
    expect(violation).toMatchObject({
      status: 403,
      message: "Origin not allowed.",
      reason: "origin_missing_or_malformed",
    });
  });

  it("denies malformed Origin when allowlist is set", async () => {
    const violation = await policy(["example.com"]).enforceWidgetRequest(
      requestWithOrigin("not-a-url"),
      { source: "widget" },
    );
    expect(violation).toMatchObject({
      status: 403,
      reason: "origin_missing_or_malformed",
    });
  });

  it("skips domain checks for playground source", async () => {
    const violation = await policy(["example.com"]).enforceWidgetRequest(
      requestWithOrigin("https://evil.com"),
      { source: "playground" },
    );
    expect(violation).toBeNull();
  });
});
