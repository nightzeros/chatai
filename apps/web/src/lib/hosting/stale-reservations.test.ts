import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from: selectFrom }));

const returning = vi.fn();
const updateWhere = vi.fn(() => ({ returning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));

const db = vi.fn(() => ({ select, update }));

vi.mock("@/lib/db", () => ({
  db: () => db(),
}));

vi.mock("@/lib/env", () => ({
  env: { HOSTED_USAGE_RECONCILE_STALE_MINUTES: 15 },
}));

const releaseUsage = vi.fn(async (_input?: unknown) => undefined);

vi.mock("./reservation", () => ({
  releaseUsage: (input: unknown) => releaseUsage(input),
}));

describe("reconcileStaleReservations", () => {
  beforeEach(() => {
    selectLimit.mockReset();
    returning.mockReset();
    releaseUsage.mockReset();
    update.mockClear();
  });

  it("claims reserved rows then releases balance micros", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "evt-1",
        accountId: "acct-1",
        reservedCostMicros: 250,
        metadata: { periodStart: "2026-03-01T00:00:00.000Z" },
      },
    ]);
    returning.mockResolvedValueOnce([{ id: "evt-1" }]);

    const { reconcileStaleReservations } = await import("./stale-reservations");
    const now = new Date("2026-03-01T01:00:00.000Z");
    const released = await reconcileStaleReservations({
      olderThanMinutes: 15,
      now,
    });

    expect(released).toBe(1);
    expect(releaseUsage).toHaveBeenCalledWith({
      accountId: "acct-1",
      periodStart: new Date("2026-03-01T00:00:00.000Z"),
      reservedMicros: 250,
    });
  });

  it("skips rows already claimed by a concurrent worker", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "evt-2",
        accountId: "acct-1",
        reservedCostMicros: 100,
        metadata: { periodStart: "2026-03-01T00:00:00.000Z" },
      },
    ]);
    returning.mockResolvedValueOnce([]);

    const { reconcileStaleReservations } = await import("./stale-reservations");
    const released = await reconcileStaleReservations({
      now: new Date("2026-03-01T01:00:00.000Z"),
    });

    expect(released).toBe(0);
    expect(releaseUsage).not.toHaveBeenCalled();
  });

  it("skips rows missing metadata.periodStart", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "evt-3",
        accountId: "acct-1",
        reservedCostMicros: 100,
        metadata: {},
      },
    ]);

    const { reconcileStaleReservations } = await import("./stale-reservations");
    const released = await reconcileStaleReservations({
      now: new Date("2026-03-01T01:00:00.000Z"),
    });

    expect(released).toBe(0);
    expect(releaseUsage).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
