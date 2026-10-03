import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrCreateUsagePeriodBalance = vi.fn();
const remainingMicros = vi.fn(
  (balance: { limitMicros: number; consumedMicros: number; reservedMicros: number }) =>
    Math.max(0, balance.limitMicros - balance.consumedMicros - balance.reservedMicros),
);
const usagePercent = vi.fn(
  (balance: { limitMicros: number; consumedMicros: number; reservedMicros: number }) => {
    if (balance.limitMicros <= 0) return 100;
    const used = balance.consumedMicros + balance.reservedMicros;
    return Math.min(100, (used / balance.limitMicros) * 100);
  },
);

vi.mock("./period-balance", () => ({
  getOrCreateUsagePeriodBalance: (...args: unknown[]) => getOrCreateUsagePeriodBalance(...args),
  remainingMicros: (...args: unknown[]) =>
    remainingMicros(...(args as [{ limitMicros: number; consumedMicros: number; reservedMicros: number }])),
  usagePercent: (...args: unknown[]) =>
    usagePercent(...(args as [{ limitMicros: number; consumedMicros: number; reservedMicros: number }])),
}));

const resolvePlanRequestCap = vi.fn();
const getPlanEntitlement = vi.fn();
const resolveEffectiveLimitMicros = vi.fn();

vi.mock("./entitlements", () => ({
  resolvePlanRequestCap: (...args: unknown[]) => resolvePlanRequestCap(...args),
  getPlanEntitlement: (...args: unknown[]) => getPlanEntitlement(...args),
  resolveEffectiveLimitMicros: (...args: unknown[]) => resolveEffectiveLimitMicros(...args),
}));

const getVoiceUsageReport = vi.fn();
vi.mock("@/lib/voice/usage-report", () => ({
  getVoiceUsageReport: (...args: unknown[]) => getVoiceUsageReport(...args),
}));

vi.mock("@/lib/db", () => ({
  db: () => ({
    execute: vi.fn(async () => []),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              offset: async () => [],
            }),
          }),
        }),
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

describe("parseRecentLimitParam / parseRecentOffsetParam", () => {
  it("defaults and clamps limit", async () => {
    const { parseRecentLimitParam, parseRecentOffsetParam } = await import("./usage-reports");
    expect(parseRecentLimitParam(null)).toBe(50);
    expect(parseRecentLimitParam("")).toBe(50);
    expect(parseRecentLimitParam("10")).toBe(10);
    expect(parseRecentLimitParam("0")).toBe(1);
    expect(parseRecentLimitParam("999")).toBe(100);
    expect(parseRecentLimitParam("abc")).toBe(50);
    expect(parseRecentOffsetParam(null)).toBe(0);
    expect(parseRecentOffsetParam("-5")).toBe(0);
    expect(parseRecentOffsetParam("20")).toBe(20);
  });
});

describe("getUsageSummary / getUsageLimits", () => {
  beforeEach(() => {
    getOrCreateUsagePeriodBalance.mockReset();
    resolvePlanRequestCap.mockReset();
    getPlanEntitlement.mockReset();
    resolveEffectiveLimitMicros.mockReset();
  });

  it("builds a period summary from the balance row", async () => {
    getOrCreateUsagePeriodBalance.mockResolvedValueOnce({
      id: "bal-1",
      accountId: "acct-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      periodEnd: new Date("2026-04-01T00:00:00.000Z"),
      limitMicros: 1_000_000,
      consumedMicros: 250_000,
      reservedMicros: 50_000,
      requestCount: 12,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    resolvePlanRequestCap.mockResolvedValueOnce(null);
    getVoiceUsageReport.mockResolvedValueOnce({
      countedSeconds: 312,
      limitSeconds: 600,
      reservedSeconds: 300,
      playgroundSeconds: 95,
      totalSeconds: 407,
    });

    const { getUsageSummary } = await import("./usage-reports");
    const summary = await getUsageSummary(account);

    expect(summary).toEqual({
      accountId: "acct-1",
      planCode: "free",
      status: "active",
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
      limitMicros: 1_000_000,
      consumedMicros: 250_000,
      reservedMicros: 50_000,
      remainingMicros: 700_000,
      usagePercent: 30,
      requestCount: 12,
      monthlyRequestCap: null,
      voice: {
        voiceSecondsUsed: 312,
        voiceSecondsLimit: 600,
        voiceSecondsReserved: 300,
        playgroundVoiceSeconds: 95,
      },
    });
    // Customers see minutes, never provider cost.
    expect(JSON.stringify(summary.voice)).not.toMatch(/micros|cost/i);
  });

  it("builds limits with plan + override precedence fields", async () => {
    getPlanEntitlement.mockResolvedValueOnce({
      planCode: "free",
      monthlyLimitMicros: 5_000_000,
      monthlyRequestCap: 1000,
      features: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    resolveEffectiveLimitMicros.mockResolvedValueOnce(5_000_000);
    resolvePlanRequestCap.mockResolvedValueOnce(1000);

    const { getUsageLimits } = await import("./usage-reports");
    const limits = await getUsageLimits(account);

    expect(limits).toEqual({
      accountId: "acct-1",
      status: "active",
      planCode: "free",
      planLimitMicros: 5_000_000,
      limitOverrideMicros: null,
      effectiveLimitMicros: 5_000_000,
      monthlyRequestCap: 1000,
      periodAnchor: "2026-01-01T00:00:00.000Z",
    });
  });
});
