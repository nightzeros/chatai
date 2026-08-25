import { describe, expect, it, vi } from "vitest";

import { runRetentionPass } from "./retention-worker";

describe("runRetentionPass", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");

  it("respects per-assistant retention cutoffs and skips off", async () => {
    const deleteExpired = vi.fn(async (_id: string, cutoff: Date) => {
      if (cutoff.toISOString() === "2026-08-17T12:00:00.000Z") return 2; // 7d
      if (cutoff.toISOString() === "2026-07-25T12:00:00.000Z") return 1; // 30d
      if (cutoff.toISOString() === "2026-05-26T12:00:00.000Z") return 3; // 90d
      return 0;
    });
    const anonymize = vi.fn(async () => 0);

    const result = await runRetentionPass({
      now,
      listAssistants: async () => [
        { id: "a7", privacySettings: { retentionDays: 7 } },
        { id: "a30", privacySettings: { retentionDays: 30 } },
        { id: "a90", privacySettings: { retentionDays: 90 } },
        { id: "off", privacySettings: { retentionDays: "off" } },
      ],
      deleteExpiredConversations: deleteExpired,
      anonymizeVisitors: anonymize,
    });

    expect(result.purged).toBe(6);
    expect(result.failures).toBe(0);
    expect(deleteExpired).toHaveBeenCalledTimes(3);
    expect(deleteExpired).not.toHaveBeenCalledWith("off", expect.anything());
  });

  it("anonymizes only when enabled, using PrivacyPolicy cutoff", async () => {
    const anonymize = vi.fn(async () => 4);
    const result = await runRetentionPass({
      now,
      listAssistants: async () => [
        {
          id: "anon",
          privacySettings: { anonymizeVisitorIds: true, retentionDays: 90 },
        },
        {
          id: "no-anon",
          privacySettings: { anonymizeVisitorIds: false, retentionDays: 90 },
        },
      ],
      deleteExpiredConversations: async () => 0,
      anonymizeVisitors: anonymize,
    });

    expect(result.anonymized).toBe(4);
    expect(anonymize).toHaveBeenCalledTimes(1);
    expect(anonymize).toHaveBeenCalledWith(
      "anon",
      new Date("2026-07-25T12:00:00.000Z"), // 30d window
    );
  });

  it("isolates assistant failures", async () => {
    const result = await runRetentionPass({
      now,
      listAssistants: async () => [
        { id: "bad", privacySettings: { retentionDays: 7 } },
        { id: "good", privacySettings: { retentionDays: 7 } },
      ],
      deleteExpiredConversations: async (id) => {
        if (id === "bad") throw new Error("boom");
        return 1;
      },
      anonymizeVisitors: async () => 0,
      log: () => undefined,
    });

    expect(result.failures).toBe(1);
    expect(result.purged).toBe(1);
  });
});
