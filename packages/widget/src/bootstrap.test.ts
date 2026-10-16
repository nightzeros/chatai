import { describe, expect, it } from "vitest";

import { optionsFromScript } from "./bootstrap";

describe("optionsFromScript", () => {
  it("derives the API origin from a hosted widget script", () => {
    const script = document.createElement("script");
    script.src = "https://chat.example.com/widget/chat.js";
    script.dataset.assistantId = "asst_demo";
    script.dataset.theme = "dark";
    script.dataset.position = "bottom-left";

    expect(optionsFromScript(script)).toEqual({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      theme: "dark",
      position: "bottom-left",
    });
  });

  it("uses data-api-url when the bundle is self-hosted elsewhere", () => {
    const script = document.createElement("script");
    script.src = "https://static.example.com/chat.js";
    script.dataset.assistantId = "asst_demo";
    script.dataset.apiUrl = "https://api.example.com/";

    expect(optionsFromScript(script)).toMatchObject({
      assistantId: "asst_demo",
      apiUrl: "https://api.example.com",
    });
  });

  it("reads data-sign-endpoint when present", () => {
    const script = document.createElement("script");
    script.src = "https://chat.example.com/widget/chat.js";
    script.dataset.assistantId = "asst_demo";
    script.dataset.signEndpoint = "https://chat.example.com/api/v1/widget/sign";

    expect(optionsFromScript(script)).toMatchObject({
      assistantId: "asst_demo",
      signEndpoint: "https://chat.example.com/api/v1/widget/sign",
    });
  });

  it("reads voice appearance script attributes and ignores unfinished experiences", () => {
    const script = document.createElement("script");
    script.src = "https://chat.example.com/widget/chat.js";
    script.dataset.assistantId = "asst_demo";
    script.dataset.voiceExperience = "orb";
    script.dataset.voiceCaptions = "off";

    expect(optionsFromScript(script)).toMatchObject({
      voiceAppearance: { experience: "orb", captionsDefault: false },
    });

    script.dataset.voiceExperience = "dock";
    delete script.dataset.voiceCaptions;
    expect(optionsFromScript(script)).toMatchObject({
      voiceAppearance: { experience: "dock" },
    });

    script.dataset.voiceExperience = "guided";
    expect(optionsFromScript(script)).toMatchObject({
      voiceAppearance: { experience: "guided" },
    });

    script.dataset.voiceExperience = "companion";
    expect(optionsFromScript(script)).toMatchObject({
      voiceAppearance: { experience: "companion" },
    });

    script.dataset.voiceExperience = "side-panel";
    expect(optionsFromScript(script)).toMatchObject({
      voiceAppearance: { experience: "side-panel" },
    });

    script.dataset.voiceExperience = "hologram";
    expect(optionsFromScript(script).voiceAppearance).toBeUndefined();
  });
});
