// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountWidget } from "./mount";

// Next's CSS loader emits an empty JS module for this Vite-specific query.
vi.mock("./styles.css?inline", () => ({ default: "" }));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("mountWidget", () => {
  async function installConfigFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          assistantId: "asst_demo",
          name: "Demo assistant",
          welcomeMessage: "Welcome to the field console.",
          settings: { primaryColor: "#0f766e", suggestedQuestions: ["Saved question"] },
        }),
      ),
    );
  }

  it("renders an isolated launcher and opens its chat panel", async () => {
    await installConfigFetch();
    const target = document.createElement("div");
    document.body.append(target);

    const instance = mountWidget(target, {
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
    });

    await Promise.resolve();
    const root = target.shadowRoot;
    expect(root?.querySelector('[aria-label="Open chat"]')).not.toBeNull();

    (root?.querySelector('[aria-label="Open chat"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(root?.querySelector('[role="dialog"]')).not.toBeNull();
    const launcher = root?.querySelector(".chatai-launcher") as HTMLButtonElement;
    expect(launcher.getAttribute("aria-expanded")).toBe("true");
    expect(launcher.getAttribute("aria-label")).toBe("Close chat");

    instance.destroy();
    expect(target.shadowRoot?.childElementCount).toBe(0);
  });

  it("uses draft mount overrides ahead of public config", async () => {
    await installConfigFetch();
    const target = document.createElement("div");
    document.body.append(target);

    const instance = mountWidget(target, {
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      primaryColor: "#112233",
      suggestedQuestions: ["Draft question"],
    });

    await Promise.resolve();
    const root = target.shadowRoot;
    expect((root?.querySelector(".chatai-widget") as HTMLElement).style.getPropertyValue("--chatai-accent")).toBe("#112233");
    expect(root?.querySelector('[aria-label="Open chat"]')).not.toBeNull();
    (root?.querySelector('[aria-label="Open chat"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(root?.textContent).toContain("Draft question");
    expect(root?.textContent).not.toContain("Saved question");
    instance.destroy();
  });

  it("adds contained layout for an embedded preview", async () => {
    await installConfigFetch();
    const target = document.createElement("div");
    document.body.append(target);

    const instance = mountWidget(target, {
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      layout: "contained",
    });

    await Promise.resolve();
    expect(target.shadowRoot?.querySelector(".chatai-widget")?.className).toContain("layout-contained");
    instance.destroy();
  });

  it("keeps widget CSS inside the mounted Shadow Root with a Next-compatible loader", async () => {
    await installConfigFetch();
    const target = document.createElement("div");
    document.body.append(target);

    mountWidget(target, {
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
    });

    expect(target.shadowRoot?.querySelector("style")?.textContent).toContain(".chatai-launcher");
  });

  it("anchors the launcher and panel to the configured screen corner", async () => {
    await installConfigFetch();
    const target = document.createElement("div");
    document.body.append(target);

    mountWidget(target, {
      assistantId: "asst_demo",
      apiUrl: "https://chat.example.com",
      position: "bottom-left",
      layout: "contained",
    });

    await Promise.resolve();
    const styleText = target.shadowRoot?.querySelector("style")?.textContent ?? "";
    expect(styleText).toContain("align-items: flex-end");
    expect(styleText).toContain(".chatai-widget.position-left");
    expect(styleText).toContain(".chatai-widget.position-left .chatai-launcher");
    expect(styleText).toContain("border-radius: 24px 24px 24px 8px");
  });
});
