import { describe, expect, it } from "vitest";

import { previewWidgetOptions } from "./widget-preview";

describe("previewWidgetOptions", () => {
  it("uses unsaved draft settings in an isolated contained widget", () => {
    const options = previewWidgetOptions({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      settings: {
        primaryColor: "#112233",
        theme: "dark",
        showSources: false,
        suggestedQuestions: ["Draft question"],
      },
    });

    expect(options).toMatchObject({
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      layout: "contained",
      primaryColor: "#112233",
      theme: "dark",
      showSources: false,
      suggestedQuestions: ["Draft question"],
    });
    expect(options.storage?.getItem("chatai.widget.asst_demo.visitor")).toBeNull();
  });
});
