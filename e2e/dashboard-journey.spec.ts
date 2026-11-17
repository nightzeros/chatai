import { expect, test, type Page } from "@playwright/test";

import { assistantId } from "./fixtures";

function workspaceNav(page: Page) {
  return page.getByLabel("Assistant pages");
}

function heading(page: Page, name: string) {
  return page.getByRole("heading", { name, exact: true });
}

test("dashboard journey covers Overview through Configure", async ({ page }) => {
  const base = `/dashboard/assistants/${assistantId}`;
  await page.goto(base);
  await expect(heading(page, "Overview")).toBeVisible();
  await expect(heading(page, "Setup checklist")).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Knowledge", exact: true }).click();
  await expect(heading(page, "Knowledge")).toBeVisible();
  await expect(page.getByRole("button", { name: "Websites" })).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Playground", exact: true }).click();
  await expect(heading(page, "Playground")).toBeVisible();
  await expect(page.getByText("Public chat API")).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Widget", exact: true }).click();
  await expect(heading(page, "Widget")).toBeVisible();
  await expect(page.getByLabel("Accent color")).toBeVisible();

  await page.getByRole("tab", { name: "Embed", exact: true }).click();
  await expect(page.getByText("Copy → Paste → Done")).toBeVisible();
  await expect(heading(page, "Hosted script")).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Conversations", exact: true }).click();
  await expect(heading(page, "Conversations")).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Insights", exact: true }).click();
  await expect(heading(page, "Insights")).toBeVisible();
  await expect(heading(page, "Unanswered questions")).toBeVisible();

  await workspaceNav(page).getByRole("link", { name: "Settings", exact: true }).click();
  await expect(heading(page, "Settings")).toBeVisible();

  await page.goto(`${base}/settings/security`);
  await expect(page.getByLabel("Allowed domains")).toBeVisible();

  await page.goto(`${base}/settings/privacy`);
  await expect(page.getByText("Store visitor conversations")).toBeVisible();
});

test("account theme controls render", async ({ page }) => {
  await page.goto("/dashboard/account");
  await expect(heading(page, "Account")).toBeVisible();
  await expect(page.getByRole("group", { name: "Theme" })).toBeVisible();
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Light" }).click();
});
