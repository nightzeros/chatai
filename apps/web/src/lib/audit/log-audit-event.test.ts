import { describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const insert = vi.fn(() => ({ values: insertValues }));
const db = vi.fn(() => ({ insert }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("../ids", () => ({
  createId: () => "audit-event-1",
}));

describe("sanitizeAuditMetadata", () => {
  it("strips sensitive keys and nested objects", async () => {
    const { sanitizeAuditMetadata } = await import("./log-audit-event");
    expect(
      sanitizeAuditMetadata({
        requireWidgetSigning: true,
        widgetSigningSecret: "nope",
        apiKey: "sk-secret",
        password: "x",
        fields: ["name", "instructions"],
        nested: { apiKey: "still-secret" },
      }),
    ).toEqual({
      requireWidgetSigning: true,
      fields: ["name", "instructions"],
    });
  });
});

describe("logAuditEvent", () => {
  it("inserts a sanitized audit row", async () => {
    insertValues.mockResolvedValueOnce(undefined);
    const { logAuditEvent } = await import("./log-audit-event");
    await logAuditEvent({
      userId: "user-1",
      action: "assistant_deleted",
      resourceType: "assistant",
      resourceId: "asst-1",
      metadata: { name: "Support", secret: "drop-me" },
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "audit-event-1",
        userId: "user-1",
        action: "assistant_deleted",
        resourceType: "assistant",
        resourceId: "asst-1",
        metadata: { name: "Support" },
      }),
    );
  });

  it("swallows insert failures", async () => {
    insertValues.mockRejectedValueOnce(new Error("db down"));
    const { logAuditEvent } = await import("./log-audit-event");
    await expect(
      logAuditEvent({ userId: "user-1", action: "login" }),
    ).resolves.toBeUndefined();
  });
});
