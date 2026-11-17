import { describe, expect, it } from "vitest";

import {
  assistantSettingsSchema,
  normalizePublicAssistantSettings,
  settingsFromFormData,
  voiceAppearanceSchema,
} from "./assistant-settings";

describe("assistantSettingsSchema", () => {
  it("normalizes valid widget display settings", () => {
    expect(
      assistantSettingsSchema.parse({
        primaryColor: "#1f4d3a",
        position: "bottom-left",
        theme: "dark",
        iconUrl: "https://cdn.example.com/leaf.svg",
        suggestedQuestions: ["  Where is my order?  ", "How do refunds work?"],
        showSources: true,
      }),
    ).toEqual({
      primaryColor: "#1F4D3A",
      position: "bottom-left",
      theme: "dark",
      iconUrl: "https://cdn.example.com/leaf.svg",
      suggestedQuestions: ["Where is my order?", "How do refunds work?"],
      showSources: true,
    });
  });

  it("rejects unsafe or oversized widget settings", () => {
    expect(() =>
      assistantSettingsSchema.parse({
        primaryColor: "orange",
        iconUrl: "http://example.com/icon.svg",
        suggestedQuestions: Array.from({ length: 6 }, () => "Question"),
      }),
    ).toThrow();
  });

  it("accepts Orb, Dock, Guided, Companion, and Side panel and rejects unfinished styles", () => {
    expect(
      voiceAppearanceSchema.parse({
        experience: "orb",
        accentColor: "#615f23",
        captionsDefault: true,
        motion: "reduced",
      }),
    ).toEqual({
      experience: "orb",
      accentColor: "#615F23",
      captionsDefault: true,
      motion: "reduced",
    });
    expect(voiceAppearanceSchema.parse({ experience: "dock" })).toEqual({ experience: "dock" });
    expect(voiceAppearanceSchema.parse({ experience: "guided" })).toEqual({ experience: "guided" });
    expect(voiceAppearanceSchema.parse({ experience: "companion" })).toEqual({
      experience: "companion",
    });
    expect(voiceAppearanceSchema.parse({ experience: "side-panel" })).toEqual({
      experience: "side-panel",
    });
    expect(() => voiceAppearanceSchema.parse({ experience: "hologram" })).toThrow();
  });
});

describe("normalizePublicAssistantSettings", () => {
  it("keeps a valid voiceAppearance and drops an unfinished one", () => {
    expect(
      normalizePublicAssistantSettings({
        primaryColor: "#112233",
        voiceAppearance: { experience: "side-panel", captionsDefault: false },
      }),
    ).toEqual({
      primaryColor: "#112233",
      voiceAppearance: { experience: "side-panel", captionsDefault: false },
    });
    expect(
      normalizePublicAssistantSettings({
        primaryColor: "#112233",
        // Unfinished experience dropped; other valid leaves kept for Classic defaults.
        voiceAppearance: { experience: "hologram", captionsDefault: false },
      } as unknown as Parameters<typeof normalizePublicAssistantSettings>[0]),
    ).toEqual({
      primaryColor: "#112233",
      voiceAppearance: { captionsDefault: false },
    });
  });
});

describe("settingsFromFormData", () => {
  it("parses voice appearance fields without requiring every leaf", () => {
    const form = new FormData();
    form.set("primaryColor", "#171717");
    form.set("position", "bottom-right");
    form.set("theme", "system");
    form.set("showSources", "on");
    form.set("voiceExperience", "orb");
    form.set("voiceCaptionsDefault", "on");
    expect(settingsFromFormData(form)).toMatchObject({
      primaryColor: "#171717",
      voiceAppearance: { experience: "orb", captionsDefault: true },
    });
  });

  it("parses captions default off for Orb", () => {
    const form = new FormData();
    form.set("position", "bottom-right");
    form.set("theme", "system");
    form.set("voiceExperience", "orb");
    form.set("voiceCaptionsDefault", "off");
    form.set("voiceMotion", "reduced");
    expect(settingsFromFormData(form)).toMatchObject({
      voiceAppearance: { experience: "orb", captionsDefault: false, motion: "reduced" },
    });
  });
});
