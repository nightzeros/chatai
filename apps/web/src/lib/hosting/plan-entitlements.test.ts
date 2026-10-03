import { beforeEach, describe, expect, it, vi } from "vitest";

const getPlanEntitlement = vi.fn();

vi.mock("@/lib/env", () => ({ env: { HOSTED_USAGE_DEFAULT_LIMIT_MICROS: 5_000_000 } }));
vi.mock("./entitlements", () => ({
  getPlanEntitlement: (...args: unknown[]) => getPlanEntitlement(...args),
}));

import { resolveAccountEntitlements, resolveVoiceSecondsLimit } from "./plan-entitlements";

const account = { planCode: "starter" as const, limitOverrideMicros: null };

function planRow(features: Record<string, unknown>) {
  return {
    planCode: "starter",
    monthlyLimitMicros: 10_000_000,
    monthlyRequestCap: null,
    features,
  };
}

describe("Voice entitlements", () => {
  beforeEach(() => getPlanEntitlement.mockReset());

  it("reads Voice minutes and concurrency from plan features", async () => {
    getPlanEntitlement.mockResolvedValue(
      planRow({ voiceMinutesMonthly: 45, maxConcurrentVoiceSessions: 3 }),
    );
    const resolved = await resolveAccountEntitlements(account);
    expect(resolved).toMatchObject({ voiceMinutesMonthly: 45, maxConcurrentVoiceSessions: 3 });
    expect(await resolveVoiceSecondsLimit(account)).toBe(2700);
  });

  it("explicit null means unlimited", async () => {
    getPlanEntitlement.mockResolvedValue(
      planRow({ voiceMinutesMonthly: null, maxConcurrentVoiceSessions: null }),
    );
    const resolved = await resolveAccountEntitlements(account);
    expect(resolved.voiceMinutesMonthly).toBeNull();
    expect(resolved.maxConcurrentVoiceSessions).toBeNull();
    expect(await resolveVoiceSecondsLimit(account)).toBeNull();
  });

  it("missing or invalid keys fall back to the provisional catalog", async () => {
    getPlanEntitlement.mockResolvedValue(planRow({ voiceMinutesMonthly: "lots" }));
    const resolved = await resolveAccountEntitlements(account);
    expect(resolved).toMatchObject({ voiceMinutesMonthly: 120, maxConcurrentVoiceSessions: 2 });
  });

  it("0 minutes means Voice is not included", async () => {
    getPlanEntitlement.mockResolvedValue(planRow({ voiceMinutesMonthly: 0 }));
    expect(await resolveVoiceSecondsLimit(account)).toBe(0);
  });

  it("uses catalog defaults when the plan row is missing", async () => {
    getPlanEntitlement.mockResolvedValue(null);
    expect(await resolveVoiceSecondsLimit({ planCode: "free", limitOverrideMicros: null })).toBe(600);
  });
});
