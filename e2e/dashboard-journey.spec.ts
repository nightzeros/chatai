import { expect, test } from "@playwright/test";

import { assistantId, signIn } from "./fixtures";

test("dashboard journey covers Overview through Configure", async ({ page }) => {
  await signIn(page);

  await page.goto(`/dashboard/assistants/${assistantId}`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Setup checklist")).toBeVisible();

  await page.getByRole("link", { name: "Knowledge" }).first().click();
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Websites" })).toBeVisible();

  await page.getByRole("link", { name: "Playground" }).first().click();
  await expect(page.getByText("Talking to")).toBeVisible();

  await page.getByRole("link", { name: "Customize" }).first().click();
  await expect(page.getByRole("heading", { name: "Customize" })).toBeVisible();

  await page.getByRole("link", { name: "Install" }).first().click();
  await expect(page.getByText("Copy → Paste → Done")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hosted script" })).toBeVisible();

  await page.getByRole("link", { name: "Conversations" }).first().click();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();

  await page.getByRole("link", { name: "Analytics" }).first().click();
  await expect(page.getByRole("heading", { name: "Unanswered questions" })).toBeVisible();

  await page.getByRole("link", { name: "Security" }).first().click();
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  await expect(page.getByLabel("Allowed domains")).toBeVisible();

  await page.getByRole("link", { name: "Privacy" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByText("Store visitor conversations")).toBeVisible();
});

test("account theme controls render", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard/account");
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light" }).click();
});
