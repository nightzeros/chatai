import { describe, expect, it } from "vitest";

import { assistantSettingsSchema } from "./assistant-settings";

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
});
