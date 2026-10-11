import { expect, test, type Page, type Request } from "@playwright/test";

import { assistantId, signIn } from "./fixtures";

/** The mint endpoint only, not its `/:sessionId/...` sub-routes. */
const MINT = "**/api/v1/voice/sessions";
const GATE = /\/api\/v1\/voice\/sessions\/[^/]+\/gate$/;

function isMint(request: Request) {
  return request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/voice/sessions";
}

function waitForMint(page: Page) {
  return page.waitForResponse((response) => isMint(response.request()));
}

function capabilities(request: Request) {
  return (request.postDataJSON() as { capabilities?: string[] }).capabilities ?? [];
}

// VOICE_PROVIDER=mock (playwright.config.ts): the control plane runs for real, no audio flows.
test.describe("Voice (preview) client contract", () => {
  test("Playground mints with playback_gate and opens the gate stream", async ({ page }) => {
    await signIn(page);
    await page.goto(`/dashboard/assistants/${assistantId}/playground`);

    const mint = waitForMint(page);
    const gate = page.waitForRequest((request) => GATE.test(new URL(request.url()).pathname));
    await page.getByRole("button", { name: "Start voice" }).click();

    const response = await mint;
    expect(capabilities(response.request())).toEqual(expect.arrayContaining(["heartbeat", "playback_gate"]));
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ playbackGate: true });
    await gate;

    await expect(page.getByText("Voice · Listening")).toBeVisible();
    await page.getByRole("button", { name: "End voice" }).click();
    await expect(page.getByText("Voice · Ended")).toBeVisible();
  });

  test("Playground shows an outdated client's refusal as unavailable, with no Reconnect", async ({ page }) => {
    await signIn(page);
    await page.goto(`/dashboard/assistants/${assistantId}/playground`);
    // An outdated client: the real server refuses a mint without playback_gate.
    await page.route(MINT, async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.continue({ postData: JSON.stringify({ ...body, capabilities: ["heartbeat"] }) });
    });

    const mint = waitForMint(page);
    await page.getByRole("button", { name: "Start voice" }).click();
    const response = await mint;
    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "client_update_required" });

    await expect(page.getByText("Voice · Not available")).toBeVisible();
    await expect(page.getByText(/Voice needs an updated chat widget/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start voice" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
  });

  test("hosted widget mints with playback_gate and connects", async ({ page }) => {
    await page.goto("/e2e/hosted.html");
    const host = page.locator("chatai-widget-host");
    await host.getByRole("button", { name: "Open chat" }).click();

    const mint = waitForMint(page);
    const gate = page.waitForRequest((request) => GATE.test(new URL(request.url()).pathname));
    await host.getByRole("button", { name: "Start voice conversation" }).click();

    const response = await mint;
    expect(capabilities(response.request())).toEqual(expect.arrayContaining(["heartbeat", "playback_gate"]));
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ playbackGate: true });
    await gate;

    const end = host.getByRole("button", { name: "End voice conversation" });
    await expect(end).toBeVisible();
    await end.click();
    await expect(host.getByRole("button", { name: "Start voice conversation" })).toBeVisible();
  });
});
