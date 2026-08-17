# v0.2 Verification and Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the v0.2 widget delivery paths with focused browser tests,
examples, documentation, and CI release gates.

**Architecture:** Add small workspace examples which consume the existing
hosted IIFE and private React wrapper. Use Playwright Chromium against a
deterministic seeded local app for the Customize and widget critical path.
Aggregate existing Vitest suites under a root `test` command, then sequence
that command, build, hosted-asset smoke, and Playwright in CI.

**Tech Stack:** pnpm workspaces, Turborepo, Playwright Chromium, Vitest,
Next.js, Vite, React, static HTML.

## Global Constraints

- Packages remain `private: true`; examples must use `workspace:*`, not npm.
- CI browser coverage is Chromium-only and limited to Customize save/draft
  preview, hosted widget boot, self-host boot, and one public chat turn.
- Existing lint, typecheck, build, and `widget:check` checks remain.
- Fixtures contain no API keys or secrets.
- `publicId` is a publishable capability; allowlists and rate limits remain
  deferred to v0.8.
- Docker image build is out of scope for this CI pass.

---

### Task 1: Add runnable hosted and React examples

**Files:**
- Create: `examples/html-widget/index.html`
- Create: `examples/html-widget/self-host.html`
- Create: `examples/html-widget/chat.js` (copied only by a local example setup script)
- Create: `examples/html-widget/README.md`
- Create: `examples/react-widget/package.json`
- Create: `examples/react-widget/index.html`
- Create: `examples/react-widget/src/main.tsx`
- Create: `examples/react-widget/src/App.tsx`
- Create: `examples/react-widget/vite.config.ts`
- Create: `examples/react-widget/README.md`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

**Interfaces:**
- HTML accepts `CHATAI_ORIGIN` and `CHATAI_ASSISTANT_ID` as explicit
  replacement values documented in its README.
- React accepts `VITE_CHATAI_ORIGIN` and `VITE_CHATAI_ASSISTANT_ID` through
  Vite environment variables.
- Root `examples:prepare-widget` copies the built widget into the self-hosted
  HTML fixture.

- [ ] **Step 1: Write the failing fixture smoke assertions**

Create `scripts/check-widget-examples.mjs` that reads fixture files and checks
that:

```js
assert.match(hostedHtml, /data-assistant-id/);
assert.match(hostedHtml, /\/widget\/chat\.js/);
assert.match(selfHostedHtml, /data-api-url/);
assert.match(reactApp, /ChatWidget/);
assert.match(reactPackage, /"@chatai\/react": "workspace:\*"/);
```

- [ ] **Step 2: Run the fixture assertion to verify it fails**

Run: `node scripts/check-widget-examples.mjs`  
Expected: FAIL because the examples and checker do not exist.

- [ ] **Step 3: Implement the examples and copy helper**

Create a hosted HTML page containing:

```html
<script
  src="http://localhost:3000/widget/chat.js"
  data-assistant-id="asst_replace_me"
  async
></script>
```

Create a self-host page that loads `./chat.js` and sets
`data-api-url="http://localhost:3000"`. Create the React page with:

```tsx
<ChatWidget
  assistantId={import.meta.env.VITE_CHATAI_ASSISTANT_ID}
  apiUrl={import.meta.env.VITE_CHATAI_ORIGIN}
/>
```

Add `examples/*` to workspace globs and root scripts:

```json
"examples:prepare-widget": "pnpm widget:build && node scripts/copy-widget-example.mjs",
"examples:check": "node scripts/check-widget-examples.mjs"
```

- [ ] **Step 4: Run the fixture checks**

Run: `pnpm examples:prepare-widget && pnpm examples:check`  
Expected: exit code 0 and copied `examples/html-widget/chat.js`.

### Task 2: Add focused Playwright browser integration coverage

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/fixtures.ts`
- Create: `e2e/widget.spec.ts`
- Create: `scripts/seed-e2e.mjs`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- `pnpm e2e` starts the built web app at `http://127.0.0.1:3000`.
- `seed-e2e.mjs` prints/writes `E2E_ASSISTANT_ID`, and creates a ready,
  deterministic assistant/document fixture with an answer path suitable for
  one test chat turn.
- Tests use `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_ASSISTANT_ID`, and
  `E2E_BASE_URL`; defaults match CI only.

- [ ] **Step 1: Write the failing Playwright critical-path spec**

Add tests with these assertions:

```ts
test("draft preview updates and settings save", async ({ page }) => {
  await signIn(page);
  await page.goto(`/dashboard/assistants/${assistantId}/customize`);
  await page.getByLabel("Accent color").fill("#112233");
  await expect(page.getByText("Draft preview — not published until you save.")).toBeVisible();
  await page.getByRole("button", { name: "Save widget settings" }).click();
  await expect(page.getByText("Widget settings saved.")).toBeVisible();
});

test("hosted widget loads and sends one message", async ({ page }) => {
  await page.goto("/e2e/hosted.html");
  const shadow = page.locator("chatai-widget-host").locator("shadow=button[aria-label='Open chat']");
  await shadow.click();
  await shadow.getByPlaceholder("Ask a question…").fill("What is the refund period?");
  await shadow.getByRole("button", { name: "Send message" }).click();
  await expect(shadow.getByText(/30-day|refund/i)).toBeVisible();
});
```

Add a self-hosted test that asserts the copied bundle mounts a launcher with
`data-api-url`.

- [ ] **Step 2: Run Playwright to verify the spec fails**

Run: `pnpm e2e`  
Expected: FAIL because Playwright configuration, fixtures, and seed data do
not exist.

- [ ] **Step 3: Implement deterministic test hosting and seed**

Serve the static fixtures from `apps/web/public/e2e/` or a dedicated local
static server reachable by Playwright. The seed script must set a known
assistant public ID in an environment file consumed by the fixture generator;
it must not parse console output. Configure Playwright to start
`pnpm --filter @chatai/web start` only after the CI build and to reuse an
already-running local server outside CI.

- [ ] **Step 4: Run Chromium locally**

Run: `pnpm exec playwright install chromium && pnpm e2e`  
Expected: Chromium completes the four focused assertions: Customize draft,
save, hosted launcher + chat, and self-host launcher.

### Task 3: Document widget delivery and operating limits

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `apps/web/src/components/assistants/install-snippets.tsx`
- Test: `apps/web/src/lib/install-snippets.test.ts`

**Interfaces:**
- README documents production URLs generically as
  `https://your-chatai-instance.example`.
- React documentation explicitly says private workspace packages require a
  monorepo install until publishing.
- Install UI expresses the same constraint as README.

- [ ] **Step 1: Write failing documentation-copy assertions**

Extend the snippet tests:

```ts
expect(snippets.reactInstall).toContain("workspace");
expect(snippets.securityNote).toMatch(/public ID/i);
expect(snippets.securityNote).toMatch(/allowlists.*v0\.8/i);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chatai/web test -- src/lib/install-snippets.test.ts`  
Expected: FAIL because React install copy still implies public npm availability.

- [ ] **Step 3: Update docs and UI copy**

Add README sections:

```md
## Embed the widget
## Self-host `chat.js`
## React workspace integration
## Customize settings
## Security and CORS
## Troubleshooting
```

Include exact hosted and self-host tags, a `data-api-url` origin-mismatch
explanation, supported settings, browser support baseline, and the public ID
security limitation. Extend the monorepo tree with `widget-core`, `widget`,
and `react`.

- [ ] **Step 4: Run documentation/snippet checks**

Run: `pnpm --filter @chatai/web test -- src/lib/install-snippets.test.ts && pnpm examples:check`  
Expected: both commands exit 0.

### Task 4: Enforce release gates in CI

**Files:**
- Modify: `package.json`
- Modify: `turbo.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/check-widget-asset.mjs`

**Interfaces:**
- Root `pnpm test` runs all package test scripts through Turbo.
- `pnpm e2e` is the browser release gate.
- CI retains `pnpm widget:check` after build and has an HTTP smoke of
  `/widget/chat.js`.

- [ ] **Step 1: Write failing CI/static checks**

Create `scripts/check-ci-widget-release.mjs`:

```js
assert.match(workflow, /pnpm test/);
assert.match(workflow, /playwright install.*chromium/i);
assert.match(workflow, /pnpm e2e/);
assert.match(workflow, /widget\/chat\.js/);
assert.match(turbo, /"test"/);
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `node scripts/check-ci-widget-release.mjs`  
Expected: FAIL because current CI does not run unit or Playwright tests.

- [ ] **Step 3: Add test aggregation and CI steps**

Add the Turbo task:

```json
"test": {
  "dependsOn": ["^test"],
  "outputs": []
}
```

Add root `test: "turbo run test"`. In CI, add unit tests after typecheck,
Chromium installation after build, a background production server, curl headers
and bootstrap-marker assertions for `/widget/chat.js`, database migration/seed
needed by e2e, then `pnpm e2e`.

- [ ] **Step 4: Run static CI checks**

Run: `node scripts/check-ci-widget-release.mjs && pnpm test`  
Expected: static check passes and every package suite passes.

### Task 5: Complete the v0.2 release gate

**Files:**
- Modify: `.cursor/plans/v0.2-widget-delivery_4377be0c.plan.md`

- [ ] **Step 1: Run all repository gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm widget:check
pnpm examples:prepare-widget
pnpm examples:check
pnpm e2e
```

Expected: every command exits 0.

- [ ] **Step 2: Perform manual responsive checks**

Open the hosted HTML example at desktop width and at 375px width. Confirm the
launcher remains visible, the panel fits the viewport, and the widget is still
usable after opening and closing.

- [ ] **Step 3: Update v0.2 plan state**

Set `v02-verification` to `completed` only after the full command sequence and
both manual responsive checks pass.
