# npm publish (Trusted Publishing)

ChatAI publishes four client libraries to the public npm registry under the **`@nightzeros`** scope (npm org **`nightzeros`**):

| Package | Purpose |
| --- | --- |
| `@nightzeros/chatai-widget-core` | Browser widget runtime |
| `@nightzeros/chatai-widget` | Preact mount API (`mountWidget`) |
| `@nightzeros/chatai-react` | React / Next.js `<ChatWidget />` |
| `@nightzeros/chatai-sdk` | Node REST + SSE client |

**Default auth:** [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (GitHub Actions OIDC). The workflow [`.github/workflows/publish-npm.yml`](../../.github/workflows/publish-npm.yml) does **not** use `NPM_TOKEN` on the normal release path.

Hosted zero-install embed remains unchanged: `https://app.nightzeros.com/widget/chat.js` (not published in npm tarballs).

## Architecture

```text
app.nightzeros.com        → hosted ChatAI API + /widget/chat.js
docs.nightzeros.com       → documentation
@nightzeros/chatai-react             → React/Next client library
@nightzeros/chatai-sdk               → server/Node SDK
/widget/chat.js           → zero-install browser embed
```

## One-time npm organization setup

1. Confirm npm org **`nightzeros`** exists and owns the **`@nightzeros`** scope.
2. Add org members with publish rights.
3. Enable **two-factor authentication** on every publishing account.

## Trusted Publisher (repeat per package)

Configure for **`@nightzeros/chatai-widget-core`**, **`@nightzeros/chatai-widget`**, **`@nightzeros/chatai-react`**, and **`@nightzeros/chatai-sdk`**:

1. npmjs.com → **Packages** → package (or create a placeholder on first publish).
2. **Settings** → **Publishing access** → **Trusted Publishers**.
3. **Add GitHub Actions trusted publisher:**
   - **Organization / user:** `master-tecs`
   - **Repository:** `chatai`
   - **Workflow filename:** `publish-npm.yml` (exact match)
   - **Environment (recommended):** `npm`
4. Save.

First publish may require the package namespace to exist or the trusted publisher to be linked before `npm publish --provenance` succeeds. Link all four publishers before approving the first release.

## GitHub repository setup

1. **Settings → Environments → `npm`**
   - Required reviewers (recommended)
   - Deployment branches: restrict to `main` and/or tags as you prefer
2. **No `NPM_TOKEN` secret** is required for the default OIDC workflow.

## Workflow behavior

| Trigger | Behavior |
| --- | --- |
| Push tag `v*` | Runs **validate + pack**; `publish` job uses environment `npm` (approval gate) |
| `workflow_dispatch` | Inputs: `publish` (default false), `dry_run` (default true on dispatch) |

Validate job runs: lint, typecheck, test, build, `pnpm widget:check`, `pnpm packages:verify`, `pnpm packages:verify-install`, and uploads packed tarballs as artifacts.

Publish job order (dependency order):

1. `@nightzeros/chatai-widget-core`
2. `@nightzeros/chatai-widget`
3. `@nightzeros/chatai-react`
4. `@nightzeros/chatai-sdk`

Each publish uses `npm publish --access public --provenance`. The script fails if `@nightzeros/chatai-*@VERSION` already exists on npm (no `--force`).

## Local verification (before first release)

```bash
pnpm packages:sync-versions
pnpm packages:build
pnpm packages:verify
pnpm packages:verify-install
```

Inspect tarballs under `/tmp/chatai-npm-pack/`.

Dry-run publish (rewrites `workspace:*` → semver, no upload if combined with workflow `dry_run`):

```bash
node scripts/prepare-package-manifests.mjs .npm-publish
# then in each prepared package dir:
npm publish --dry-run --access public --provenance
```

Or trigger **Publish npm packages** workflow dispatch with `publish=true`, `dry_run=true`, and approve the `npm` environment when prompted.

## Version sync

Root [`VERSION`](../../VERSION) is canonical. Before pack/publish:

```bash
pnpm packages:sync-versions
```

This updates all four publishable `package.json` files.

## Emergency token fallback

See [`npm-publish-fallback.md`](./npm-publish-fallback.md). The workflow [`.github/workflows/publish-npm-token-fallback.yml`](../../.github/workflows/publish-npm-token-fallback.yml) is disabled by default (`if: false`).

## Related

- [npm package audit](./npm-package-audit.md)
- [Release checklist](../RELEASE.md)
- [Production VPS deployment](./vps.md)
