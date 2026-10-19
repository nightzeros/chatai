import { expect, test } from "@playwright/test";

import { assistantId } from "./fixtures";

/** Prefer the nested workspace nav in the app shell (desktop) or drawer content. */
function workspaceNav(page: import("@playwright/test").Page) {
  return page.getByLabel("Assistant pages");
}

test("dashboard journey covers Overview through Configure", async ({ page }) => {
  const base = `/dashboard/assistants/${assistantId}`;
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Setup checklist" }).first()).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Knowledge" }).click();
  await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Websites" })).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Playground" }).click();
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  await expect(page.getByText("Public chat API")).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Widget" }).click();
  await expect(page.getByRole("heading", { name: "Widget" })).toBeVisible();
  await expect(page.getByLabel("Accent color")).toBeVisible();

  await page.getByRole("link", { name: "Embed" }).click();
  await expect(page.getByText("Copy → Paste → Done")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hosted script" })).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Conversations" }).click();
  await expect(page.getByRole("heading", { name: "Conversations" })).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Insights" }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unanswered questions" })).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.goto(`${base}/settings/security`);
  await expect(page.getByLabel("Allowed domains")).toBeVisible();

  await page.goto(`${base}/settings/privacy`);
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
