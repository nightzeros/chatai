import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));
const db = vi.fn(() => ({ select }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    WIDGET_RATE_LIMIT_PER_VISITOR_PER_MINUTE: 20,
    WIDGET_RATE_LIMIT_PER_ASSISTANT_PER_MINUTE: 120,
    WIDGET_SIGNING_MAX_SKEW_SECONDS: 300,
  },
}));

vi.mock("@/lib/cors", () => ({
  corsHeaders: {
    "Access-Control-Allow-Origin": "*",
  },
  jsonWithCors: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    Response.json(body, {
      status: init?.status ?? 200,
      headers: init?.headers,
    }),
}));

vi.mock("@/lib/policies/policy-response", () => ({
  policyViolationResponse: (violation: { status: number; message: string }) =>
    Response.json({ error: violation.message }, { status: violation.status }),
}));

const enforceWidgetRequest = vi.fn();
const fromAssistant = vi.fn(() => ({
  resolved: { widgetSigningSecret: "server-secret-only" as string | null },
  enforceWidgetRequest,
}));

vi.mock("@/lib/policies/security-policy", () => ({
  SecurityPolicy: { fromAssistant },
}));

vi.mock("@/lib/policies/checks/widget-signature", () => ({
  createWidgetSignature: vi.fn(() => "t=1700000000,v1=abc"),
}));

describe("POST /api/v1/widget/sign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    fromAssistant.mockReturnValue({
      resolved: { widgetSigningSecret: "server-secret-only" as string | null },
      enforceWidgetRequest,
    });
    enforceWidgetRequest.mockResolvedValue(null);
    selectLimit.mockResolvedValue([
      {
        id: "asst_internal",
        publicId: "asst_public",
        securitySettings: {
          requireWidgetSigning: true,
          widgetSigningSecret: "server-secret-only",
        },
      },
    ]);
  });

  it("issues a signature without requiring an existing signature header", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/widget/sign", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: "https://example.com",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({ assistantId: "asst_public", visitorId: "visitor01" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ timestamp: expect.any(Number), signature: "t=1700000000,v1=abc" });
    expect(JSON.stringify(body)).not.toContain("server-secret-only");
    expect(enforceWidgetRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        source: "widget",
        visitorId: "visitor01",
        skipSignatureCheck: true,
      }),
    );
  });

  it("returns policy violations from domain/rate/bot gates", async () => {
    enforceWidgetRequest.mockResolvedValueOnce({
      status: 429,
      message: "Too many requests.",
      reason: "rate_limit_visitor",
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/widget/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantId: "asst_public", visitorId: "visitor01" }),
      }),
    );
    expect(response.status).toBe(429);
  });

  it("rejects when signing is not configured", async () => {
    fromAssistant.mockReturnValueOnce({
      resolved: { widgetSigningSecret: null },
      enforceWidgetRequest,
    });
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/widget/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantId: "asst_public", visitorId: "visitor01" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(enforceWidgetRequest).not.toHaveBeenCalled();
  });

  it("rejects short visitorId bodies", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/widget/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantId: "asst_public", visitorId: "short" }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
