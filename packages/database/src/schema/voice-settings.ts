import type { PrivacySettings } from "./privacy-settings";
import { defaultPrivacySettings } from "./privacy-settings";

/**
 * Per-assistant Voice capability settings (jsonb on assistants.voice_settings).
 * Persistence flags never override global privacy.storeConversations === false.
 */
export type VoiceSettings = {
  /** When false, public config should not offer Voice. Default false until enabled. */
  enabled?: boolean;
  /** RealtimeVoiceProvider id (e.g. gpt-live). Empty = instance default. */
  provider?: string | null;
  /** Provider model id. Empty = instance / package default. */
  model?: string | null;
  /** Speaking voice id. Empty = instance / package default. */
  voiceId?: string | null;
  /** Persist voice turn text into messages when storeConversations allows. */
  saveTranscripts?: boolean;
  /** Persist audio objects when storeConversations allows. Default false. */
  saveAudioRecordings?: boolean;
  /**
   * Optional recording retention window in days.
   * Must not exceed conversation retention when both apply (enforced later).
   */
  recordingRetentionDays?: "off" | 7 | 30 | 90;
  /** Require explicit consent at session mint when recordings would be saved. */
  requireRecordingConsent?: boolean;
};

export const defaultVoiceSettings: {
  enabled: boolean;
  provider: null;
  model: null;
  voiceId: null;
  saveTranscripts: boolean;
  saveAudioRecordings: boolean;
  recordingRetentionDays: "off";
  requireRecordingConsent: boolean;
} = {
  enabled: false,
  provider: null,
  model: null,
  voiceId: null,
  saveTranscripts: true,
  saveAudioRecordings: false,
  recordingRetentionDays: "off",
  requireRecordingConsent: true,
};

export type ResolvedVoiceSettings = {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  voiceId: string | null;
  saveTranscripts: boolean;
  saveAudioRecordings: boolean;
  recordingRetentionDays: "off" | 7 | 30 | 90;
  requireRecordingConsent: boolean;
};

export type EffectiveVoicePersistence = {
  /** Global no-store wins: false when privacy.storeConversations is false. */
  storeConversations: boolean;
  /** May be true only when storeConversations is true. */
  saveTranscripts: boolean;
  /** May be true only when storeConversations is true. */
  saveAudioRecordings: boolean;
  /** True when the session must not leave durable rows after end. */
  ephemeral: boolean;
  requireRecordingConsent: boolean;
};

export function resolveVoiceSettings(
  settings?: VoiceSettings | null,
): ResolvedVoiceSettings {
  return {
    ...defaultVoiceSettings,
    ...settings,
    provider: settings?.provider ?? defaultVoiceSettings.provider,
    model: settings?.model ?? defaultVoiceSettings.model,
    voiceId: settings?.voiceId ?? defaultVoiceSettings.voiceId,
    saveTranscripts: settings?.saveTranscripts ?? defaultVoiceSettings.saveTranscripts,
    saveAudioRecordings:
      settings?.saveAudioRecordings ?? defaultVoiceSettings.saveAudioRecordings,
    recordingRetentionDays:
      settings?.recordingRetentionDays ?? defaultVoiceSettings.recordingRetentionDays,
    requireRecordingConsent:
      settings?.requireRecordingConsent ?? defaultVoiceSettings.requireRecordingConsent,
    enabled: settings?.enabled ?? defaultVoiceSettings.enabled,
  };
}

/**
 * Apply global privacy + assistant voice settings.
 * Assistant settings may only make behavior more private; they never override no-store.
 */
export function resolveEffectiveVoicePersistence(
  privacy?: PrivacySettings | null,
  voice?: VoiceSettings | null,
): EffectiveVoicePersistence {
  const storeConversations =
    privacy?.storeConversations ?? defaultPrivacySettings.storeConversations;
  const resolvedVoice = resolveVoiceSettings(voice);

  if (!storeConversations) {
    return {
      storeConversations: false,
      saveTranscripts: false,
      saveAudioRecordings: false,
      ephemeral: true,
      requireRecordingConsent: resolvedVoice.requireRecordingConsent,
    };
  }

  return {
    storeConversations: true,
    saveTranscripts: resolvedVoice.saveTranscripts,
    saveAudioRecordings: resolvedVoice.saveAudioRecordings,
    ephemeral: false,
    requireRecordingConsent: resolvedVoice.requireRecordingConsent,
  };
}
