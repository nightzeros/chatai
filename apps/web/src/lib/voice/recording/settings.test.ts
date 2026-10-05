import { describe, expect, it } from "vitest";

import { formatClock, recordingCardState } from "./card-state";
import { validateRecordingSettings } from "./settings";

const base = {
  saveAudioRecordings: true,
  recordingRetention: "off",
  storeConversations: true,
  objectStorageAvailable: true,
  conversationRetentionDays: "off" as const,
};

describe("validateRecordingSettings", () => {
  it("accepts recording with storage on and object storage configured", () => {
    expect(validateRecordingSettings({ ...base, recordingRetention: "30" })).toEqual({
      ok: true,
      value: { saveAudioRecordings: true, recordingRetentionDays: 30 },
    });
  });

  it("refuses to turn recording on under global no-store or without object storage", () => {
    expect(validateRecordingSettings({ ...base, storeConversations: false }).ok).toBe(false);
    expect(validateRecordingSettings({ ...base, objectStorageAvailable: false })).toEqual({
      ok: false,
      error: "Recording is not configured on this instance (object storage is not set up).",
    });
  });

  it("always allows turning recording off", () => {
    expect(
      validateRecordingSettings({
        ...base,
        saveAudioRecordings: false,
        storeConversations: false,
        objectStorageAvailable: false,
      }),
    ).toEqual({ ok: true, value: { saveAudioRecordings: false, recordingRetentionDays: "off" } });
  });

  it("caps recording retention by conversation retention", () => {
    expect(
      validateRecordingSettings({ ...base, recordingRetention: "90", conversationRetentionDays: 30 }).ok,
    ).toBe(false);
    expect(
      validateRecordingSettings({ ...base, recordingRetention: "7", conversationRetentionDays: 30 }).ok,
    ).toBe(true);
    // "Keep with the conversation" never outlives it.
    expect(
      validateRecordingSettings({ ...base, recordingRetention: "off", conversationRetentionDays: 7 }).ok,
    ).toBe(true);
  });

  it("rejects unknown retention values", () => {
    expect(validateRecordingSettings({ ...base, recordingRetention: "365" }).ok).toBe(false);
  });
});

describe("recordingCardState", () => {
  const ready = { status: "ready" as const, partial: false, expiresAt: null, deletedAt: null };

  it("ready recordings are playable and describe retention", () => {
    expect(recordingCardState(ready)).toMatchObject({
      playable: true,
      poll: false,
      message: "Kept while this conversation is kept.",
    });
    expect(recordingCardState({ ...ready, expiresAt: "2026-10-27T12:00:00.000Z" }).message).toBe(
      "Deleted automatically on Oct 27, 2026 (recording retention).",
    );
  });

  it("pending polls, failed and expired are not playable", () => {
    expect(recordingCardState({ ...ready, status: "pending" })).toMatchObject({ playable: false, poll: true });
    expect(recordingCardState({ ...ready, status: "failed" }).playable).toBe(false);
    expect(
      recordingCardState({ ...ready, status: "expired", deletedAt: "2026-09-01T12:00:00.000Z" }).message,
    ).toBe("Recording deleted on Sep 1, 2026 by the retention setting.");
    expect(recordingCardState(ready, { unavailable: true })).toMatchObject({
      playable: false,
      message: "Recording is no longer available.",
    });
  });

  it("partial recordings say so", () => {
    expect(recordingCardState({ ...ready, partial: true })).toMatchObject({ playable: true, tone: "warning" });
  });

  it("formats durations", () => {
    expect(formatClock(null)).toBe("--:--");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
});
