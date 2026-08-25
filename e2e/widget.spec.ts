import { expect, test } from "@playwright/test";

import { assistantId, signIn } from "./fixtures";

test("draft preview updates and settings save", async ({ page }) => {
  await signIn(page);
  await page.goto(`/dashboard/assistants/${assistantId}/customize`);
  await page.getByLabel("Accent color").fill("#112233");

  const previewAside = page.locator("aside").filter({ hasText: "Draft preview" });
  await expect
    .poll(async () =>
      previewAside.evaluate((aside) => {
        const mount = aside.querySelector("div.h-full");
        const widget = mount?.shadowRoot?.querySelector(".chatai-widget") as HTMLElement | null;
        return widget?.style.getPropertyValue("--chatai-accent") ?? "";
      }),
    )
    .toBe("#112233");

  await page.getByRole("button", { name: "Save widget settings" }).click();
  await expect(page.getByText("Widget settings saved.")).toBeVisible();
});

test("hosted widget opens, closes with Escape, and sends one message", async ({ page }) => {
  await page.goto("/e2e/hosted.html");
  // Playwright pierces open shadow roots; `chatai-widget-host` is the mount target.
  const host = page.locator("chatai-widget-host");
  await host.getByRole("button", { name: "Open chat" }).click();
  await expect(host.getByRole("dialog")).toBeVisible();
  await host.getByPlaceholder("Ask a question…").press("Escape");
  await expect(host.getByRole("dialog")).toHaveCount(0);
  await host.getByRole("button", { name: "Open chat" }).click();
  await host.getByPlaceholder("Ask a question…").fill("What is the refund period?");
  await host.getByRole("button", { name: "Send message" }).click();
  // Scope to assistant turns so the user input ("…refund…") cannot false-pass.
  await expect(host.locator(".chatai-message.assistant").last()).toContainText(/30-day|refund/i, {
    timeout: 60_000,
  });
});

test("self-hosted widget mounts launcher with data-api-url", async ({ page }) => {
  await page.goto("/e2e/self-host.html");
  await expect(page.locator("script[data-api-url][data-assistant-id]")).toBeAttached();
  const host = page.locator("chatai-widget-host");
  await expect(host.getByRole("button", { name: "Open chat" })).toBeVisible();
});
