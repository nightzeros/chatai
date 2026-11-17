import { describe, expect, it } from "vitest";

import {
  mergeVoiceAppearance,
  parseVoiceAppearance,
  resolveVoiceAppearance,
} from "./voice-appearance";

describe("voice appearance", () => {
  it("resolves missing settings to Classic with captions on and system motion", () => {
    expect(resolveVoiceAppearance(undefined)).toEqual({
      experience: "classic",
      captionsDefault: true,
      motion: "system",
    });
  });

  it("keeps a supported Orb appearance and uppercases accent", () => {
    expect(
      resolveVoiceAppearance({
        experience: "orb",
        accentColor: "#615f23",
        captionsDefault: false,
        motion: "reduced",
      }),
    ).toEqual({
      experience: "orb",
      accentColor: "#615F23",
      captionsDefault: false,
      motion: "reduced",
    });
  });

  it("keeps Dock, Guided, Companion, and Side panel and maps unfinished experiences to Classic", () => {
    expect(parseVoiceAppearance({ experience: "dock" })).toEqual({ experience: "dock" });
    expect(parseVoiceAppearance({ experience: "guided" })).toEqual({ experience: "guided" });
    expect(parseVoiceAppearance({ experience: "companion" })).toEqual({ experience: "companion" });
    expect(parseVoiceAppearance({ experience: "side-panel" })).toEqual({ experience: "side-panel" });
    expect(resolveVoiceAppearance({ experience: "guided", captionsDefault: false })).toEqual({
      experience: "guided",
      captionsDefault: false,
      motion: "system",
    });
    expect(resolveVoiceAppearance({ experience: "companion", captionsDefault: false })).toEqual({
      experience: "companion",
      captionsDefault: false,
      motion: "system",
    });
    expect(resolveVoiceAppearance({ experience: "side-panel", captionsDefault: false })).toEqual({
      experience: "side-panel",
      captionsDefault: false,
      motion: "system",
    });
    expect(resolveVoiceAppearance({ experience: "hologram", captionsDefault: true })).toEqual({
      experience: "classic",
      captionsDefault: true,
      motion: "system",
    });
  });

  it("rejects malformed colors and non-boolean captions", () => {
    expect(parseVoiceAppearance({ accentColor: "olive", captionsDefault: "on" })).toEqual({});
  });

  it("merges appearance per leaf so one override does not wipe the rest", () => {
    expect(
      mergeVoiceAppearance(
        { experience: "orb", captionsDefault: false, motion: "system" },
        { accentColor: "#112233" },
      ),
    ).toEqual({
      experience: "orb",
      captionsDefault: false,
      motion: "system",
      accentColor: "#112233",
    });
  });
});
