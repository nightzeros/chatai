# npm publish fallback (NPM_TOKEN)

Use this **only** when npm Trusted Publishing (OIDC) is unavailable—for example, npm registry outage affecting OIDC, or before trusted publishers are linked and you need an emergency patch.

**Default path:** [npm-publish.md](./npm-publish.md) and [`.github/workflows/publish-npm.yml`](../../.github/workflows/publish-npm.yml).

## When to use

- Trusted Publisher is not yet configured for all four packages.
- OIDC publish failed and you cannot wait for npm support.
- One-off manual publish from a maintainer machine (still prefer CI when possible).

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
pnpm packages:build
pnpm packages:verify
npm login   # or export NODE_AUTH_TOKEN=...
node scripts/publish-npm-packages.mjs --dry-run
node scripts/publish-npm-packages.mjs
```

Publish order is enforced by [`scripts/publish-npm-packages.mjs`](../../scripts/publish-npm-packages.mjs): widget-core → widget → react → sdk.

## Security notes

- Rotate `NPM_TOKEN` after emergency use if it was exposed.
- Prefer re-enabling Trusted Publishing and removing token-based workflows from routine releases.
- Never commit tokens or `.npmrc` with auth to the repository.
