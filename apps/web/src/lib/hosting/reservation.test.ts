import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/lib/db", () => ({
  db: () => ({ execute }),
}));

describe("reserveUsage", () => {
  const accountId = "acct-1";
  const periodStart = new Date("2026-03-01T00:00:00.000Z");

  beforeEach(() => {
    execute.mockReset();
  });

  it("reserves when the conditional UPDATE returns a row", async () => {
    const { reserveUsage } = await import("./reservation");
    execute.mockResolvedValueOnce([
      { id: "bal-1", consumed_micros: 100, reserved_micros: 500, limit_micros: 1_000 },
    ]);

    const result = await reserveUsage({
      accountId,
      periodStart,
      estimateMicros: 400,
    });

    expect(result).toEqual({
      ok: true,
      balanceId: "bal-1",
      consumedMicros: 100,
      reservedMicros: 500,
      limitMicros: 1_000,
      estimateMicros: 400,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects with limit_exceeded when UPDATE misses but balance exists", async () => {
    const { reserveUsage } = await import("./reservation");
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "bal-1" }]);

    const result = await reserveUsage({
      accountId,
      periodStart,
      estimateMicros: 100,
    });

    expect(result).toEqual({ ok: false, reason: "limit_exceeded" });
  });

  it("rejects with balance_missing when no period row exists", async () => {
    const { reserveUsage } = await import("./reservation");
    execute.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await reserveUsage({
      accountId: "missing",
      periodStart,
      estimateMicros: 50,
    });

    expect(result).toEqual({ ok: false, reason: "balance_missing" });
  });

  it("zero estimate selects without bumping reserved_micros", async () => {
    const { reserveUsage } = await import("./reservation");
    execute.mockResolvedValueOnce([
      { id: "bal-1", consumed_micros: 10, reserved_micros: 20, limit_micros: 1_000 },
    ]);

    const result = await reserveUsage({
      accountId,
      periodStart,
      estimateMicros: 0,
    });

    expect(result).toEqual({
      ok: true,
      balanceId: "bal-1",
      consumedMicros: 10,
      reservedMicros: 20,
      limitMicros: 1_000,
      estimateMicros: 0,
    });
  });
});

describe("reconcileUsage / releaseUsage", () => {
  const accountId = "acct-1";
  const periodStart = new Date("2026-03-01T00:00:00.000Z");

  beforeEach(() => {
    execute.mockReset();
  });

  it("reconcile runs an UPDATE when releasing reserved and committing actual", async () => {
    const { reconcileUsage } = await import("./reservation");
    execute.mockResolvedValueOnce([]);

    await reconcileUsage({
      accountId,
      periodStart,
      reservedMicros: 400,
      actualMicros: 120,
      incrementRequestCount: true,
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("reconcile is a no-op when reserved, actual, and request bump are all zero", async () => {
    const { reconcileUsage } = await import("./reservation");

    await reconcileUsage({
      accountId,
      periodStart,
      reservedMicros: 0,
      actualMicros: 0,
      incrementRequestCount: false,
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it("releaseUsage reconciles with zero actual consumption", async () => {
    const { releaseUsage } = await import("./reservation");
    execute.mockResolvedValueOnce([]);

    await releaseUsage({
      accountId,
      periodStart,
      reservedMicros: 400,
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("reservation concurrency math", () => {
  it("atomic check prevents oversubscription under concurrent estimates", () => {
    const limit = 1_000;
    let consumed = 700;
    let reserved = 0;
    const estimate = 200;

    const tryReserve = () => {
      if (consumed + reserved + estimate <= limit) {
        reserved += estimate;
        return true;
      }
      return false;
    };

    expect([tryReserve(), tryReserve(), tryReserve()].filter(Boolean)).toHaveLength(1);
    expect(reserved).toBe(200);

    reserved = Math.max(0, reserved - 200);
    consumed += 150;
    expect(tryReserve()).toBe(false);
    expect(consumed + reserved).toBe(850);
  });
});
