import { test as setup } from "@playwright/test";

import { authStatePath, signIn } from "./fixtures";

// Better Auth allows 3 sign-ins per 10 s, so the suite signs in once and reuses the session.
setup("sign in", async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: authStatePath });
});
