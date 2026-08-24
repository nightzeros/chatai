import { describe, expect, it } from "vitest";

import { SecurityPolicy } from "./security-policy";

describe("SecurityPolicy", () => {
  const env = {
    WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
    WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
    WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
  };

  it("builds from assistant settings", () => {
    const policy = SecurityPolicy.fromAssistant(
      {
        id: "asst_internal",
        publicId: "asst_public",
        securitySettings: { allowedDomains: ["example.com"] },
      },
      env,
    );
    expect(policy.assistantId).toBe("asst_internal");
    expect(policy.publicId).toBe("asst_public");
    expect(policy.resolved.allowedDomains).toEqual(["example.com"]);
  });

  it("enforceWidgetRequest is a Task 1 no-op pass-through", async () => {
    const policy = SecurityPolicy.fromAssistant(
      { id: "a", publicId: "asst_x", securitySettings: {} },
      env,
    );
    const violation = await policy.enforceWidgetRequest(new Request("http://localhost"), {
      visitorId: "visitor-1",
      source: "widget",
    });
    expect(violation).toBeNull();
  });
});
