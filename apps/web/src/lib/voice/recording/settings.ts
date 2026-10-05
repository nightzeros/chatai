import type { PrivacyRetentionDays, ResolvedVoiceSettings } from "@chatai/database";

type RecordingRetention = ResolvedVoiceSettings["recordingRetentionDays"];

const RETENTION_VALUES: Record<string, RecordingRetention> = {
  off: "off",
  "7": 7,
  "30": 30,
  "90": 90,
};

export type RecordingSettingsInput = {
  saveAudioRecordings: boolean;
  recordingRetention: string;
  storeConversations: boolean;
  objectStorageAvailable: boolean;
  conversationRetentionDays: PrivacyRetentionDays;
};

/**
 * Owner recording settings. Turning recording off is always allowed; turning it
 * on needs conversation storage and object storage. Recording retention may not
 * outlive conversation retention ("off" = kept as long as the conversation).
 */
export function validateRecordingSettings(
  input: RecordingSettingsInput,
):
  | { ok: true; value: { saveAudioRecordings: boolean; recordingRetentionDays: RecordingRetention } }
  | { ok: false; error: string } {
  const recordingRetentionDays = RETENTION_VALUES[input.recordingRetention];
  if (recordingRetentionDays === undefined) {
    return { ok: false, error: "Choose a valid recording retention." };
  }
  if (input.saveAudioRecordings && !input.storeConversations) {
    return {
      ok: false,
      error: "Turn on conversation storage in Privacy before recording Voice audio.",
    };
  }
  if (input.saveAudioRecordings && !input.objectStorageAvailable) {
    return {
      ok: false,
      error: "Recording is not configured on this instance (object storage is not set up).",
    };
  }
  if (
    recordingRetentionDays !== "off" &&
    input.conversationRetentionDays !== "off" &&
    recordingRetentionDays > input.conversationRetentionDays
  ) {
    return {
      ok: false,
      error: `Recording retention can't be longer than conversation retention (${input.conversationRetentionDays} days).`,
    };
  }
  return { ok: true, value: { saveAudioRecordings: input.saveAudioRecordings, recordingRetentionDays } };
}
