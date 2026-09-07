import { describe, expect, it, vi } from "vitest";

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
    HOSTED_USAGE_DEFAULT_LIMIT_MICROS: 5_000_000,
  },
}));

describe("resolveEffectiveLimitMicros", () => {
  it("prefers account limit override", async () => {
    const { resolveEffectiveLimitMicros } = await import("./entitlements");
    await expect(
      resolveEffectiveLimitMicros({
        planCode: "free",
        limitOverrideMicros: 12_000_000,
      }),
    ).resolves.toBe(12_000_000);
    expect(select).not.toHaveBeenCalled();
  });

  it("uses plan entitlement when no override", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        planCode: "free",
        monthlyLimitMicros: 5_000_000,
        monthlyRequestCap: null,
        features: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { resolveEffectiveLimitMicros } = await import("./entitlements");
    await expect(
      resolveEffectiveLimitMicros({
        planCode: "free",
        limitOverrideMicros: null,
      }),
    ).resolves.toBe(5_000_000);
  });

  it("falls back to env when plan row is missing", async () => {
    selectLimit.mockResolvedValueOnce([]);

    const { resolveEffectiveLimitMicros } = await import("./entitlements");
    await expect(
      resolveEffectiveLimitMicros({
        planCode: "free",
        limitOverrideMicros: null,
      }),
    ).resolves.toBe(5_000_000);
  });
});
