import { expect, test } from "@playwright/test";

import { assistantId } from "./fixtures";

test("dashboard journey covers Overview through Configure", async ({ page }) => {
  await page.goto(`/dashboard/assistants/${assistantId}`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Setup checklist")).toBeVisible();

  await page.getByRole("link", { name: "Knowledge" }).first().click();
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Websites" })).toBeVisible();

  await page.getByRole("link", { name: "Playground" }).first().click();
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  await expect(page.getByText("Public chat API")).toBeVisible();

  await page.getByRole("link", { name: "Widget" }).first().click();
  await expect(page.getByRole("heading", { name: "Widget" })).toBeVisible();
  await expect(page.getByLabel("Accent color")).toBeVisible();

  await page.getByRole("link", { name: "Embed" }).first().click();
  await expect(page.getByText("Copy → Paste → Done")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hosted script" })).toBeVisible();

  await page.getByRole("link", { name: "Conversations" }).first().click();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();

  await page.getByRole("link", { name: "Insights" }).first().click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unanswered questions" })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.getByRole("link", { name: "Security" }).first().click();
  await expect(page.getByLabel("Allowed domains")).toBeVisible();

  await page.getByRole("link", { name: "Privacy" }).first().click();
  await expect(page.getByText("Store visitor conversations")).toBeVisible();
});

test("account theme controls render", async ({ page }) => {
  await page.goto("/dashboard/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light" }).click();
});
