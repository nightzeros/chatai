import { beforeEach, describe, expect, it, vi } from "vitest";

const envState = {
  HOSTED_USAGE_ENFORCEMENT: "enforce" as "shadow" | "enforce" | "off",
  HOSTED_USAGE_EXEMPT_PLAYGROUND: false,
  HOSTED_USAGE_MAX_OUTPUT_TOKENS: 4096,
};

vi.mock("@/lib/env", () => ({
  env: envState,
}));

vi.mock("./period-balance", () => ({
  getOrCreateUsagePeriodBalance: vi.fn(),
}));

vi.mock("./entitlements", () => ({
  resolvePlanRequestCap: vi.fn(async () => null),
}));

vi.mock("./reservation", () => ({
  reserveUsage: vi.fn(),
  reconcileUsage: vi.fn(),
  releaseUsage: vi.fn(),
}));

vi.mock("./shadow-meter", () => ({
  recordShadowUsages: vi.fn(async () => 0),
}));

vi.mock("./pricing-catalog", () => ({
  loadModelPricingCatalog: vi.fn(async () => []),
}));

vi.mock("@/lib/ids", () => ({
  createId: () => "evt-1",
}));

const insertValues = vi.fn(async () => undefined);
vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: () => ({ values: insertValues }),
    update: () => ({
      set: () => ({
        where: async () => undefined,
      }),
    }),
  }),
}));

const account = {
  id: "acct-1",
  userId: "user-1",
  status: "active" as const,
  planCode: "free" as const,
  periodAnchor: new Date("2026-01-01T00:00:00.000Z"),
  limitOverrideMicros: null,
  polarCustomerId: null,
  polarSubscriptionId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const chat = {
  provider: "openai" as const,
  model: "gpt-4o-mini",
  apiKey: "k",
  baseURL: "https://api.openai.com/v1",
};

const embedding = {
  provider: "openai" as const,
  model: "text-embedding-3-small",
  apiKey: "k",
  baseURL: "https://api.openai.com/v1",
  dimensions: 1536,
};

describe("beginChatUsageReservation (enforce)", () => {
  beforeEach(async () => {
    envState.HOSTED_USAGE_ENFORCEMENT = "enforce";
    envState.HOSTED_USAGE_EXEMPT_PLAYGROUND = false;
    insertValues.mockClear();

    const { getOrCreateUsagePeriodBalance } = await import("./period-balance");
    const { reserveUsage } = await import("./reservation");
    const { resolvePlanRequestCap } = await import("./entitlements");

    vi.mocked(reserveUsage).mockClear();
    vi.mocked(getOrCreateUsagePeriodBalance).mockClear();
    vi.mocked(resolvePlanRequestCap).mockClear();

    vi.mocked(getOrCreateUsagePeriodBalance).mockResolvedValue({
      id: "bal-1",
      accountId: "acct-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      limitMicros: 5_000_000,
      consumedMicros: 0,
      reservedMicros: 0,
      requestCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(reserveUsage).mockResolvedValue({
      ok: true,
      balanceId: "bal-1",
      consumedMicros: 0,
      reservedMicros: 100,
      limitMicros: 5_000_000,
      estimateMicros: 100,
    });
    vi.mocked(resolvePlanRequestCap).mockResolvedValue(null);
  });

  it("returns 402 when reserve fails", async () => {
    const { reserveUsage } = await import("./reservation");
    vi.mocked(reserveUsage).mockResolvedValueOnce({ ok: false, reason: "limit_exceeded" });

    const { beginChatUsageReservation } = await import("./usage-gate");
    const result = await beginChatUsageReservation({
      account,
      assistantId: "asst-1",
      requestId: "req-1",
      chat,
      embedding,
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
      message: "hi",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
      source: "widget",
    });

    expect(result).toEqual({
      ok: false,
      status: 402,
      error: "Usage limit exceeded for this billing period.",
      reason: "usage_limit_exceeded",
    });
  });

  it("returns 402 when plan request cap is reached", async () => {
    const { resolvePlanRequestCap } = await import("./entitlements");
    const { getOrCreateUsagePeriodBalance } = await import("./period-balance");
    vi.mocked(resolvePlanRequestCap).mockResolvedValueOnce(10);
    vi.mocked(getOrCreateUsagePeriodBalance).mockResolvedValueOnce({
      id: "bal-1",
      accountId: "acct-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      limitMicros: 5_000_000,
      consumedMicros: 0,
      reservedMicros: 0,
      requestCount: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { beginChatUsageReservation } = await import("./usage-gate");
    const result = await beginChatUsageReservation({
      account,
      assistantId: "asst-1",
      requestId: "req-1",
      chat,
      embedding,
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
      message: "hi",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });

  it("skips reservation when playground is exempt", async () => {
    envState.HOSTED_USAGE_EXEMPT_PLAYGROUND = true;
    const { reserveUsage } = await import("./reservation");
    const { beginChatUsageReservation } = await import("./usage-gate");

    const result = await beginChatUsageReservation({
      account,
      assistantId: "asst-1",
      requestId: "req-1",
      chat,
      embedding,
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
      message: "hi",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
      source: "playground",
    });

    expect(result).toEqual({ ok: true, reservation: null });
    expect(reserveUsage).not.toHaveBeenCalled();
  });

  it("skips reservation in shadow mode", async () => {
    envState.HOSTED_USAGE_ENFORCEMENT = "shadow";
    const { beginChatUsageReservation } = await import("./usage-gate");
    const result = await beginChatUsageReservation({
      account,
      assistantId: "asst-1",
      requestId: "req-1",
      chat,
      embedding,
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
      message: "hi",
      hasHistory: false,
      queryExpansionEnabled: false,
      rerankEnabled: false,
      verifyCitationsEnabled: false,
      hasCohereKey: false,
    });
    expect(result).toEqual({ ok: true, reservation: null });
  });
});

describe("beginIngestUsageReservation", () => {
  beforeEach(async () => {
    envState.HOSTED_USAGE_ENFORCEMENT = "enforce";
    const { getOrCreateUsagePeriodBalance } = await import("./period-balance");
    const { reserveUsage } = await import("./reservation");
    const { resolvePlanRequestCap } = await import("./entitlements");
    vi.mocked(getOrCreateUsagePeriodBalance).mockResolvedValue({
      id: "bal-1",
      accountId: "acct-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      limitMicros: 5_000_000,
      consumedMicros: 0,
      reservedMicros: 0,
      requestCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(reserveUsage).mockResolvedValue({
      ok: true,
      balanceId: "bal-1",
      consumedMicros: 0,
      reservedMicros: 50,
      limitMicros: 5_000_000,
      estimateMicros: 50,
    });
    vi.mocked(resolvePlanRequestCap).mockResolvedValue(null);
  });

  it("throws UsageLimitExceededError when reserve fails", async () => {
    const { reserveUsage } = await import("./reservation");
    vi.mocked(reserveUsage).mockResolvedValueOnce({ ok: false, reason: "limit_exceeded" });

    const { beginIngestUsageReservation } = await import("./usage-gate");
    const { UsageLimitExceededError } = await import("./usage-limit-error");

    await expect(
      beginIngestUsageReservation({
        account,
        assistantId: "asst-1",
        requestId: "req-ingest",
        embedding,
        billingMode: "hosted",
        approxTokens: 10_000,
      }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);
  });
});
