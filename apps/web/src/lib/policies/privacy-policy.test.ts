import { describe, expect, it } from "vitest";

import { PrivacyPolicy } from "./privacy-policy";
import { resolvePrivacyPolicy } from "./resolve-privacy-policy";

describe("resolvePrivacyPolicy", () => {
  it("applies defaults", () => {
    expect(resolvePrivacyPolicy(null)).toEqual({
      storeConversations: true,
      retentionDays: 90,
      anonymizeVisitorIds: false,
    });
  });

  it("merges partial settings", () => {
    expect(resolvePrivacyPolicy({ storeConversations: false, retentionDays: 7 })).toEqual({
      storeConversations: false,
      retentionDays: 7,
      anonymizeVisitorIds: false,
    });
  });
});

describe("PrivacyPolicy", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");

  it("always persists playground conversations", () => {
    const policy = PrivacyPolicy.fromAssistant({
      privacySettings: { storeConversations: false },
    });
    expect(policy.shouldPersistConversation("playground", true)).toBe(true);
    expect(policy.shouldPersistConversation("widget", false)).toBe(false);
    expect(policy.shouldPersistConversation("api", false)).toBe(false);
  });

  it("returns null retention cutoff when retention is off", () => {
    const policy = PrivacyPolicy.fromAssistant({ privacySettings: { retentionDays: "off" } });
    expect(policy.retentionCutoff(now)).toBeNull();
  });

  it("computes retention cutoff from days", () => {
    const policy = PrivacyPolicy.fromAssistant({ privacySettings: { retentionDays: 7 } });
    expect(policy.retentionCutoff(now)?.toISOString()).toBe("2026-08-16T12:00:00.000Z");
  });

  it("anonymizes only when enabled and past the window", () => {
    const policy = PrivacyPolicy.fromAssistant({
      privacySettings: { anonymizeVisitorIds: true, retentionDays: 90 },
    });
    const recent = new Date("2026-08-20T12:00:00.000Z");
    const old = new Date("2026-07-01T12:00:00.000Z");
    expect(policy.shouldAnonymizeVisitor(recent, now)).toBe(false);
    expect(policy.shouldAnonymizeVisitor(old, now)).toBe(true);
  });

  it("uses the shorter of 30d and retention for anonymize window", () => {
    const policy = PrivacyPolicy.fromAssistant({
      privacySettings: { anonymizeVisitorIds: true, retentionDays: 7 },
    });
    const eightDaysAgo = new Date("2026-08-15T12:00:00.000Z");
    expect(policy.shouldAnonymizeVisitor(eightDaysAgo, now)).toBe(true);
    expect(policy.anonymizeCutoff(now)?.toISOString()).toBe("2026-08-16T12:00:00.000Z");
  });

  it("returns null anonymize cutoff when disabled", () => {
    const policy = PrivacyPolicy.fromAssistant({
      privacySettings: { anonymizeVisitorIds: false },
    });
    expect(policy.anonymizeCutoff(now)).toBeNull();
  });
});
