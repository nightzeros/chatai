import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit tests for webhook handler logic.
 * These test the plan resolution and idempotency patterns without a real database.
 */

// Mock the database and audit modules
vi.mock("@/lib/db", () => ({
  db: () => ({
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: "evt_test" }]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("@/lib/ids", () => ({
  createId: () => "test_id",
}));

vi.mock("@/lib/audit/log-audit-event", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/env", () => ({
  env: {
    HOSTED_USAGE_DEFAULT_LIMIT_MICROS: 5_000_000,
    HOSTED_USAGE_ENFORCEMENT: "shadow",
    STRIPE_SECRET_KEY: "sk_test_xxx",
    STRIPE_WEBHOOK_SECRET: "whsec_xxx",
  },
}));

import { planCodeFromPriceMetadata } from "../plans";

describe("webhook handler plan resolution", () => {
  it("resolves pro plan from Stripe price metadata", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "pro" })).toBe("pro");
  });

  it("resolves team plan from Stripe price metadata", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "team" })).toBe("team");
  });

  it("falls back to null for unknown plan", () => {
    expect(planCodeFromPriceMetadata({ plan_code: "unknown" })).toBeNull();
  });

  it("handles missing metadata gracefully", () => {
    expect(planCodeFromPriceMetadata(null)).toBeNull();
    expect(planCodeFromPriceMetadata(undefined)).toBeNull();
    expect(planCodeFromPriceMetadata({})).toBeNull();
  });
});
