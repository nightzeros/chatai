# npm publish fallback (NPM_TOKEN)

Use this **only** when npm Trusted Publishing (OIDC) is unavailable—for example, npm registry outage affecting OIDC, or an emergency patch before Trusted Publisher configuration is fixed.

**Default path:** [npm-publish.md](./npm-publish.md) and [`.github/workflows/publish-npm.yml`](../../.github/workflows/publish-npm.yml).

Bootstrap **`@nightzeros/chatai-*@1.0.0`** is complete (manual CLI publish, September 2025). All routine releases must use OIDC.

## When to use

- OIDC publish failed and you cannot wait for npm support
- Trusted Publisher misconfiguration blocks CI and you need an emergency patch
- One-off manual publish from a maintainer machine (still prefer CI when possible)

**Do not** use token auth for routine releases. **Do not** enable the fallback workflow on `main`.

## GitHub Actions (disabled workflow)

[`.github/workflows/publish-npm-token-fallback.yml`](../../.github/workflows/publish-npm-token-fallback.yml) is **not** attached to `v*` tags and has `if: false` on the job. To use it:

1. Remove or override the `if: false` guard in a maintainer branch (do not merge to `main` unless you intend to enable token auth).
2. Add repository secret **`NPM_TOKEN`** with publish access to `@nightzeros/chatai-*`.
3. Run **workflow_dispatch** with `dry_run=true` first.
4. Set `dry_run=false` only after inspecting dry-run output.

Alternatively pass `npm_token` as a dispatch input for a single run (avoid storing long-lived tokens in workflow inputs when possible).

## Manual publish from a maintainer machine

```bash
pnpm packages:sync-versions
node scripts/sync-package-versions.mjs --check
pnpm packages:build
pnpm packages:verify
pnpm packages:publish:dry-run
ALLOW_LOCAL_NPM_PUBLISH=1 node scripts/publish-npm-packages.mjs --publish
```

Publish order is enforced by [`scripts/publish-npm-packages.mjs`](../../scripts/publish-npm-packages.mjs): widget-core → widget → react → sdk.

**Note:** npm accounts with security-key-only 2FA may require browser CLI auth (`npm publish` → fingerprint) or a granular access token with bypass 2FA. Recovery codes often do not work for CLI publish.

## Security notes

- Rotate `NPM_TOKEN` after emergency use if it was exposed.
- Prefer re-enabling Trusted Publishing and removing token-based workflows from routine releases.
- Never commit tokens or `.npmrc` with auth to the repository.
- Revoke bootstrap granular tokens after OIDC is configured.
