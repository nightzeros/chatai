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
/** Conditional `status = 'reserved'` claim; `[]` means another path already finished it. */
const claimReturning = vi.fn(async () => [{ id: "evt-1" }] as Array<{ id: string }>);
vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: () => ({ values: insertValues }),
    update: () => ({
      set: () => ({
        where: () => Object.assign(Promise.resolve(undefined), { returning: claimReturning }),
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
      voiceSecondsLimit: null,
      voiceSecondsReserved: 0,
      voiceSecondsConsumed: 0,
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
      error:
        "You've reached your monthly hosted AI allowance. Upgrade your plan or wait until your usage period resets.",
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
      voiceSecondsLimit: null,
      voiceSecondsReserved: 0,
      voiceSecondsConsumed: 0,
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
      voiceSecondsLimit: null,
      voiceSecondsReserved: 0,
      voiceSecondsConsumed: 0,
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

describe("beginEvalUsageReservation", () => {
  beforeEach(async () => {
    envState.HOSTED_USAGE_ENFORCEMENT = "enforce";
    insertValues.mockClear();
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
      voiceSecondsLimit: null,
      voiceSecondsReserved: 0,
      voiceSecondsConsumed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(reserveUsage).mockResolvedValue({
      ok: true,
      balanceId: "bal-1",
      consumedMicros: 0,
      reservedMicros: 1_000,
      limitMicros: 5_000_000,
      estimateMicros: 1_000,
    });
    vi.mocked(resolvePlanRequestCap).mockResolvedValue(null);
  });

  it("reserves before offline eval provider work", async () => {
    const { beginEvalUsageReservation } = await import("./usage-gate");
    const { reserveUsage } = await import("./reservation");

    const reservation = await beginEvalUsageReservation({
      account,
      assistantId: "asst-1",
      requestId: "req-eval",
      kind: "offline",
      chat,
      embedding,
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
      message: "What is the refund policy?",
    });

    expect(reservation).toMatchObject({
      accountId: "acct-1",
      requestId: "req-eval",
      reservationEventId: "evt-1",
    });
    expect(reserveUsage).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalled();
  });

  it("throws when the period limit is exhausted", async () => {
    const { reserveUsage } = await import("./reservation");
    vi.mocked(reserveUsage).mockResolvedValueOnce({ ok: false, reason: "limit_exceeded" });
    const { beginEvalUsageReservation } = await import("./usage-gate");
    const { UsageLimitExceededError } = await import("./usage-limit-error");

    await expect(
      beginEvalUsageReservation({
        account,
        assistantId: "asst-1",
        requestId: "req-eval",
        kind: "online",
        chat,
        embedding,
        billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
        message: "",
      }),
    ).rejects.toBeInstanceOf(UsageLimitExceededError);
  });

  it("skips reservation in shadow mode", async () => {
    envState.HOSTED_USAGE_ENFORCEMENT = "shadow";
    const { beginEvalUsageReservation } = await import("./usage-gate");
    const { reserveUsage } = await import("./reservation");
    vi.mocked(reserveUsage).mockClear();

    await expect(
      beginEvalUsageReservation({
        account,
        assistantId: "asst-1",
        requestId: "req-eval",
        kind: "offline",
        chat,
        embedding,
        billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
        message: "hi",
      }),
    ).resolves.toBeNull();
    expect(reserveUsage).not.toHaveBeenCalled();
  });
});

describe("finishChatUsageReservation", () => {
  beforeEach(async () => {
    const { reconcileUsage } = await import("./reservation");
    const { recordShadowUsages } = await import("./shadow-meter");
    vi.mocked(reconcileUsage).mockClear();
    vi.mocked(reconcileUsage).mockResolvedValue(undefined as never);
    vi.mocked(recordShadowUsages).mockClear();
    vi.mocked(recordShadowUsages).mockResolvedValue(0);
  });

  it("still reconciles when shadow metering throws", async () => {
    const { recordShadowUsages } = await import("./shadow-meter");
    const { reconcileUsage } = await import("./reservation");
    vi.mocked(recordShadowUsages).mockRejectedValueOnce(new Error("ledger write failed"));

    const { finishChatUsageReservation } = await import("./usage-gate");
    await expect(
      finishChatUsageReservation({
        reservation: {
          accountId: "acct-1",
          periodStart: new Date("2026-03-01T00:00:00.000Z"),
          reservedMicros: 1_000,
          reservationEventId: "evt-res-1",
          requestId: "req-1",
          estimateMicros: 1_000,
        },
        accountId: "acct-1",
        assistantId: "asst-1",
        requestId: "req-1",
        records: [
          {
            kind: "chat_completion",
            provider: "openai",
            model: "gpt-4o-mini",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 0 },
            step: "test",
          },
        ],
        billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
        catalog: [],
      }),
    ).resolves.toBeUndefined();

    expect(reconcileUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-1",
        reservedMicros: 1_000,
      }),
    );
  });

  const reservation = {
    accountId: "acct-1",
    periodStart: new Date("2026-03-01T00:00:00.000Z"),
    reservedMicros: 1_000,
    reservationEventId: "evt-res-1",
    requestId: "req-1",
    estimateMicros: 1_000,
  };

  it("a finish that loses the reservation claim does not release the reservation again", async () => {
    const { reconcileUsage } = await import("./reservation");
    claimReturning.mockResolvedValueOnce([]);
    const { finishChatUsageReservation } = await import("./usage-gate");
    await finishChatUsageReservation({
      reservation,
      accountId: "acct-1",
      assistantId: "asst-1",
      requestId: "req-1",
      records: [],
      billing: { chat: "hosted", embedding: "hosted", rerank: "hosted" },
      catalog: [],
    });
    expect(reconcileUsage).toHaveBeenCalledWith(expect.objectContaining({ reservedMicros: 0 }));
  });
});

describe("abortChatUsageReservation", () => {
  it("releases only when it wins the reservation claim", async () => {
    const { releaseUsage } = await import("./reservation");
    vi.mocked(releaseUsage).mockClear();
    const { abortChatUsageReservation } = await import("./usage-gate");
    const reservation = {
      accountId: "acct-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      reservedMicros: 1_000,
      reservationEventId: "evt-res-1",
      requestId: "req-1",
      estimateMicros: 1_000,
    };

    claimReturning.mockResolvedValueOnce([{ id: "evt-res-1" }]);
    await abortChatUsageReservation(reservation);
    expect(releaseUsage).toHaveBeenCalledTimes(1);

    claimReturning.mockResolvedValueOnce([]);
    await abortChatUsageReservation(reservation);
    expect(releaseUsage).toHaveBeenCalledTimes(1);
  });
});
