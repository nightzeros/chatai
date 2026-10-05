import { describe, expect, it } from "vitest";

import {
  defaultVoiceSettings,
  resolveEffectiveVoicePersistence,
  resolveVoiceSettings,
} from "./voice-settings";
import { VOICE_EVENT_TYPES } from "./voice";

describe("resolveVoiceSettings", () => {
  it("defaults voice off and recordings off", () => {
    expect(resolveVoiceSettings(null)).toEqual(defaultVoiceSettings);
    expect(defaultVoiceSettings.enabled).toBe(false);
    expect(defaultVoiceSettings.saveAudioRecordings).toBe(false);
    expect(defaultVoiceSettings.saveTranscripts).toBe(true);
  });
});

describe("resolveEffectiveVoicePersistence", () => {
  it("forces transcripts and audio OFF when storeConversations is false", () => {
    expect(
      resolveEffectiveVoicePersistence(
        { storeConversations: false },
        {
          enabled: true,
          saveTranscripts: true,
          saveAudioRecordings: true,
        },
      ),
    ).toEqual({
      storeConversations: false,
      saveTranscripts: false,
      saveAudioRecordings: false,
      ephemeral: true,
      requireRecordingConsent: true,
    });
  });

  it("allows assistant voice settings when storeConversations is true", () => {
    expect(
      resolveEffectiveVoicePersistence(
        { storeConversations: true },
        { saveTranscripts: false, saveAudioRecordings: true },
      ),
    ).toEqual({
      storeConversations: true,
      saveTranscripts: false,
      saveAudioRecordings: true,
      ephemeral: false,
      requireRecordingConsent: true,
    });
  });

  it("defaults storeConversations to true when privacy omitted", () => {
    expect(resolveEffectiveVoicePersistence(null, null).ephemeral).toBe(false);
    expect(resolveEffectiveVoicePersistence({}, { saveAudioRecordings: true })).toMatchObject({
      storeConversations: true,
      saveAudioRecordings: true,
      ephemeral: false,
    });
  });
});

describe("VOICE_EVENT_TYPES", () => {
  it("excludes high-volume partial transcript and audio delta types", () => {
    expect(VOICE_EVENT_TYPES).not.toContain("transcript.partial");
    expect(VOICE_EVENT_TYPES).not.toContain("session.input_audio.append");
    expect(VOICE_EVENT_TYPES).not.toContain("session.output_audio.delta");
    expect(VOICE_EVENT_TYPES).toContain("transcript.final");
    expect(VOICE_EVENT_TYPES).toContain("assistant.interrupted");
  });
});
