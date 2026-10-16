import { describe, expect, it } from "vitest";
import type { WidgetVoiceState } from "@nightzeros/chatai-widget-core";

import { presentVoice, voiceStageVisible } from "./voice-presentation";

function voice(partial: Partial<WidgetVoiceState>): WidgetVoiceState {
  return { connection: "idle", phase: "idle", ...partial };
}

describe("voiceStageVisible", () => {
  it("hides the stage when Voice is idle", () => {
    expect(voiceStageVisible(voice({}))).toBe(false);
  });

  it("shows for consent, active, failed, and ended", () => {
    expect(voiceStageVisible(voice({ consentPending: true }))).toBe(true);
    expect(voiceStageVisible(voice({ connection: "connecting", phase: "connecting" }))).toBe(true);
    expect(voiceStageVisible(voice({ connection: "failed", phase: "error" }))).toBe(true);
    expect(voiceStageVisible(voice({ connection: "ended", phase: "ended" }))).toBe(true);
  });
});

describe("presentVoice", () => {
  it("maps connected phases to Orb copy and motion", () => {
    expect(presentVoice(voice({ connection: "connected", phase: "listening" }))).toMatchObject({
      status: "I’m listening",
      motion: "listening",
      canEnd: true,
      canMute: true,
    });
    expect(presentVoice(voice({ connection: "connected", phase: "user_speaking" }))).toMatchObject({
      status: "Hearing you",
      motion: "hearing",
    });
    expect(presentVoice(voice({ connection: "connected", phase: "processing" }))).toMatchObject({
      status: "Looking that up…",
      motion: "processing",
    });
    expect(presentVoice(voice({ connection: "connected", phase: "assistant_speaking" }))).toMatchObject({
      status: "Speaking",
      motion: "speaking",
    });
  });

  it("overrides status when the visitor mic is muted", () => {
    expect(
      presentVoice(
        voice({ connection: "connected", phase: "listening", microphoneMuted: true }),
      ),
    ).toMatchObject({
      status: "Microphone muted",
      microphoneMuted: true,
      canMute: true,
    });
  });

  it("keeps reconnecting static and End available", () => {
    expect(
      presentVoice(voice({ connection: "reconnecting", phase: "reconnecting", microphoneMuted: true })),
    ).toMatchObject({
      status: "Reconnecting…",
      motion: "static",
      canEnd: true,
      canMute: true,
      microphoneMuted: true,
    });
  });

  it("exposes consent and error control flags", () => {
    expect(presentVoice(voice({ consentPending: true }))).toMatchObject({
      consentPending: true,
      canDismiss: true,
      canStart: false,
    });
    expect(
      presentVoice(
        voice({
          connection: "failed",
          phase: "error",
          error: { code: "mic_denied", message: "Microphone access is blocked." },
        }),
      ),
    ).toMatchObject({
      status: "Voice stopped",
      canRetry: true,
      canDismiss: true,
      errorMessage: "Microphone access is blocked.",
    });
    expect(
      presentVoice(
        voice({
          connection: "failed",
          phase: "error",
          error: { code: "unsupported", message: "Voice is not supported." },
        }),
      ).canRetry,
    ).toBe(false);
  });

  it("surfaces ended notice with Start again", () => {
    expect(
      presentVoice(voice({ connection: "ended", phase: "ended", notice: "Voice is unavailable." })),
    ).toMatchObject({
      status: "Voice ended",
      canStart: true,
      canDismiss: true,
      notice: "Voice is unavailable.",
    });
  });
});
