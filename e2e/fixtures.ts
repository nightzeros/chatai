import { expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const envE2ePath = join(process.cwd(), ".env.e2e");

if (existsSync(envE2ePath)) {
  for (const line of readFileSync(envE2ePath, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    const value = line.slice(i + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

/** Defaults match CI; override via `.env.e2e` from `scripts/seed-e2e.mjs`. */
export const e2eEmail = process.env.E2E_EMAIL ?? "e2e@chatai.local";
export const e2ePassword = process.env.E2E_PASSWORD ?? "E2ePass123!";
export const assistantId = process.env.E2E_ASSISTANT_ID ?? "asst_e2e_v02";
export const e2eBaseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2eEmail);
  await page.getByLabel("Password").fill(e2ePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
