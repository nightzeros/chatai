import { describe, expect, it } from "vitest";
import type { ApiKeyScope } from "@chatai/database";

import { authorizeApiKeyRecord, hasApiKeyScope } from "./api-key-auth";

describe("authorizeApiKeyRecord", () => {
  const row = {
    id: "key-1",
    userId: "user-1",
    scopes: ["chat", "assistants:read"] satisfies ApiKeyScope[],
    revokedAt: null,
  };

  it("authorizes active keys with required scopes", () => {
    expect(authorizeApiKeyRecord(row, ["chat"])).toEqual({
      ok: true,
      userId: "user-1",
      apiKeyId: "key-1",
      scopes: ["chat", "assistants:read"],
    });
  });

  it("rejects revoked keys", () => {
    expect(
      authorizeApiKeyRecord({ ...row, revokedAt: new Date() }, ["chat"]),
    ).toEqual({
      ok: false,
      status: 401,
      error: "Invalid API key.",
    });
  });

  it("rejects keys missing required scopes", () => {
    expect(authorizeApiKeyRecord(row, ["analytics:read"])).toEqual({
      ok: false,
      status: 403,
      error: "Missing required scope: analytics:read",
    });
  });

  it("does not treat chat as implying voice", () => {
    expect(authorizeApiKeyRecord(row, ["voice"])).toEqual({
      ok: false,
      status: 403,
      error: "Missing required scope: voice",
    });
    expect(authorizeApiKeyRecord({ ...row, scopes: ["voice"] }, ["voice"]).ok).toBe(true);
  });
});

describe("hasApiKeyScope", () => {
  it("checks scope membership", () => {
    expect(hasApiKeyScope(["chat"], "chat")).toBe(true);
    expect(hasApiKeyScope(["chat"], "analytics:read")).toBe(false);
  });
});
