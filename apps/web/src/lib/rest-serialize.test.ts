import { describe, expect, it } from "vitest";

import { serializeAssistant, serializeDocument } from "./rest-serialize";

describe("serializeAssistant", () => {
  it("omits userId", () => {
    const serialized = serializeAssistant({
      id: "asst-1",
      publicId: "asst_public",
      userId: "user-secret",
      name: "Support",
      description: null,
      instructions: null,
      welcomeMessage: "Hi",
      hallucinationMode: "balanced",
      settings: {},
      ragSettings: {},
      modelSettings: {},
      securitySettings: {
        requireWidgetSigning: true,
        widgetSigningSecret: "must-not-leak",
      },
      privacySettings: {},
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(serialized).not.toHaveProperty("userId");
    expect(serialized).not.toHaveProperty("securitySettings");
    expect(serialized).not.toHaveProperty("privacySettings");
    expect(JSON.stringify(serialized)).not.toContain("must-not-leak");
    expect(serialized.publicId).toBe("asst_public");
  });
});

describe("serializeDocument", () => {
  it("omits storagePath and content", () => {
    const serialized = serializeDocument({
      id: "doc-1",
      assistantId: "asst-1",
      sourceId: null,
      type: "file",
      name: "guide.pdf",
      mimeType: "application/pdf",
      status: "ready",
      error: null,
      chunkCount: 4,
      content: "secret body",
      storagePath: "/tmp/guide.pdf",
      url: null,
      contentHash: "abc",
      excluded: false,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(serialized).not.toHaveProperty("storagePath");
    expect(serialized).not.toHaveProperty("content");
    expect(serialized.name).toBe("guide.pdf");
  });
});
