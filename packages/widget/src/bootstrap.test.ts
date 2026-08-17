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
});
