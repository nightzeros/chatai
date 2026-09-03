import { describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));

const returning = vi.fn();
const onConflictDoNothing = vi.fn(() => ({ returning }));
const values = vi.fn(() => ({ onConflictDoNothing }));
const insert = vi.fn(() => ({ values }));

const db = vi.fn(() => ({ select, insert }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/ids", () => ({
  createId: () => "balance-1",
}));

vi.mock("./entitlements", () => ({
  resolveEffectiveLimitMicros: vi.fn(async () => 5_000_000),
}));

describe("remainingMicros / usagePercent", () => {
  it("computes remaining and percent from balance counters", async () => {
    const { remainingMicros, usagePercent } = await import("./period-balance");
    const balance = {
      limitMicros: 1_000_000,
      consumedMicros: 250_000,
      reservedMicros: 50_000,
    };

    expect(remainingMicros(balance)).toBe(700_000);
    expect(usagePercent(balance)).toBe(30);
  });

  it("clamps remaining at zero and percent at 100", async () => {
    const { remainingMicros, usagePercent } = await import("./period-balance");
    const balance = {
      limitMicros: 100,
      consumedMicros: 80,
      reservedMicros: 40,
    };

    expect(remainingMicros(balance)).toBe(0);
    expect(usagePercent(balance)).toBe(100);
  });
});

describe("getOrCreateUsagePeriodBalance", () => {
  it("returns an existing period balance without inserting", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "existing-balance",
        accountId: "acct-1",
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        limitMicros: 5_000_000,
        consumedMicros: 0,
        reservedMicros: 0,
        requestCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { getOrCreateUsagePeriodBalance } = await import("./period-balance");
    const balance = await getOrCreateUsagePeriodBalance(
      {
        id: "acct-1",
        userId: "user-1",
        status: "active",
        planCode: "free",
        periodAnchor: new Date("2026-01-01T00:00:00.000Z"),
        limitOverrideMicros: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new Date("2026-03-15T12:00:00.000Z"),
    );

    expect(balance.id).toBe("existing-balance");
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts a balance for the current period when missing", async () => {
    selectLimit.mockResolvedValueOnce([]);
    returning.mockResolvedValueOnce([
      {
        id: "balance-1",
        accountId: "acct-2",
        periodStart: new Date("2026-03-01T00:00:00.000Z"),
        periodEnd: new Date("2026-04-01T00:00:00.000Z"),
        limitMicros: 5_000_000,
        consumedMicros: 0,
        reservedMicros: 0,
        requestCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { getOrCreateUsagePeriodBalance } = await import("./period-balance");
    const balance = await getOrCreateUsagePeriodBalance(
      {
        id: "acct-2",
        userId: "user-2",
        status: "active",
        planCode: "free",
        periodAnchor: new Date("2026-01-01T00:00:00.000Z"),
        limitOverrideMicros: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      new Date("2026-03-15T12:00:00.000Z"),
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "balance-1",
        accountId: "acct-2",
        limitMicros: 5_000_000,
        consumedMicros: 0,
        reservedMicros: 0,
        requestCount: 0,
      }),
    );
    expect(balance.id).toBe("balance-1");
  });
});
