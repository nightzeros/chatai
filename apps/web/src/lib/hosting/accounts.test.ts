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
  createId: () => "hosting-account-1",
}));

describe("checkHostingAccountAccess", () => {
  it("allows active accounts", async () => {
    const { checkHostingAccountAccess } = await import("./accounts");
    expect(checkHostingAccountAccess({ status: "active" })).toEqual({ ok: true });
  });

  it("rejects suspended accounts", async () => {
    const { checkHostingAccountAccess } = await import("./accounts");
    expect(checkHostingAccountAccess({ status: "suspended" })).toEqual({
      ok: false,
      status: 403,
      error: "Hosted AI is temporarily unavailable for this account.",
      reason: "account_suspended",
    });
  });

  it("rejects disabled accounts", async () => {
    const { checkHostingAccountAccess } = await import("./accounts");
    expect(checkHostingAccountAccess({ status: "disabled" })).toEqual({
      ok: false,
      status: 403,
      error: "Hosted AI is disabled for this account.",
      reason: "account_disabled",
    });
  });
});

describe("getOrCreateHostingAccount", () => {
  it("returns an existing account without inserting", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "existing",
        userId: "user-1",
        status: "active",
        planCode: "free",
        periodAnchor: new Date("2026-03-01T00:00:00.000Z"),
        limitOverrideMicros: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { getOrCreateHostingAccount } = await import("./accounts");
    const account = await getOrCreateHostingAccount("user-1");

    expect(account.id).toBe("existing");
    expect(insert).not.toHaveBeenCalled();
  });

  it("inserts when no account exists", async () => {
    selectLimit.mockResolvedValueOnce([]);
    returning.mockResolvedValueOnce([
      {
        id: "hosting-account-1",
        userId: "user-2",
        status: "active",
        planCode: "free",
        periodAnchor: new Date("2026-03-01T00:00:00.000Z"),
        limitOverrideMicros: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { getOrCreateHostingAccount } = await import("./accounts");
    const account = await getOrCreateHostingAccount("user-2");

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "hosting-account-1",
        userId: "user-2",
        status: "active",
        planCode: "free",
      }),
    );
    expect(account.userId).toBe("user-2");
  });
});

describe("resolveBillableAccountForAssistant", () => {
  it("provisions the assistant owner's hosting account", async () => {
    selectLimit.mockResolvedValueOnce([
      {
        id: "owner-account",
        userId: "owner-1",
        status: "active",
        planCode: "free",
        periodAnchor: new Date("2026-03-01T00:00:00.000Z"),
        limitOverrideMicros: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const { resolveBillableAccountForAssistant } = await import("./accounts");
    const account = await resolveBillableAccountForAssistant({ userId: "owner-1" });

    expect(account.id).toBe("owner-account");
  });
});
