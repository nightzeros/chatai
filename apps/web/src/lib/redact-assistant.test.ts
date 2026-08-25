import { describe, expect, it } from "vitest";

import { redactAssistantForClient } from "./redact-assistant";

describe("redactAssistantForClient", () => {
  it("nulls widgetSigningSecret while preserving other security flags", () => {
    const assistant = {
      id: "asst-1",
      securitySettings: {
        requireWidgetSigning: true,
        widgetSigningSecret: "super-secret-value",
      },
    };
    const redacted = redactAssistantForClient(assistant);
    expect(redacted.securitySettings?.widgetSigningSecret).toBeNull();
    expect(redacted.securitySettings?.requireWidgetSigning).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain("super-secret-value");
  });

  it("returns the same object when no secret is present", () => {
    const assistant = {
      securitySettings: { requireWidgetSigning: false, widgetSigningSecret: null as string | null },
    };
    expect(redactAssistantForClient(assistant)).toBe(assistant);
  });
});
