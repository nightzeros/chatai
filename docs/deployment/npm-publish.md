# npm publish (Trusted Publishing)

ChatAI publishes four client libraries to the public npm registry under the **`@nightzeros`** scope (npm org **`nightzeros`**):

| Package | Purpose |
| --- | --- |
| `@nightzeros/chatai-widget-core` | Browser widget runtime |
| `@nightzeros/chatai-widget` | Preact mount API (`mountWidget`) |
| `@nightzeros/chatai-react` | React / Next.js `<ChatWidget />` |
| `@nightzeros/chatai-sdk` | Node REST + SSE client |

**Default auth:** [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (GitHub Actions OIDC). The workflow [`.github/workflows/publish-npm.yml`](../../.github/workflows/publish-npm.yml) does **not** use `NPM_TOKEN` on the normal release path.

Bootstrap **`1.0.0`** was published manually (September 2025). All future releases use OIDC through GitHub Actions.

Hosted zero-install embed remains unchanged: `https://app.nightzeros.com/widget/chat.js` (not published in npm tarballs).

## Normal release procedure

1. Merge release-ready changes into `main`.
2. Decide the next semantic version (e.g. `1.0.1`).
3. Update root [`VERSION`](../../VERSION) and run `pnpm packages:sync-versions`.
4. Commit the version change on `main`.
5. Create an annotated tag: `git tag -a v$(cat VERSION) -m "ChatAI $(cat VERSION)"`.
6. Push the tag: `git push origin v$(cat VERSION)`.
7. GitHub Actions runs **`Publish npm packages`** (`validate` job).
8. Approve the protected GitHub environment **`npm`** when the `publish` job waits.
9. GitHub OIDC publishes all four packages with provenance.
10. The `verify-registry` job confirms versions, dist-tags, dependencies, and registry install smoke.

Alternatively, use **workflow_dispatch** on `publish-npm.yml` from `main` with explicit inputs (`publish`, `dry_run`).

## Trusted Publisher (required per package)

Configure on **each** live package page:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| GitHub owner | `master-tecs` |
| Repository | `chatai` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm` |

Packages:

- `@nightzeros/chatai-widget-core`
- `@nightzeros/chatai-widget`
- `@nightzeros/chatai-react`
- `@nightzeros/chatai-sdk`

Use the workflow **filename only** (`publish-npm.yml`), not the full `.github/workflows/` path.

## GitHub repository setup

1. **Settings → Environments → `npm`**
   - Required reviewers (recommended)
   - Deployment branches: restrict to `main` and/or `v*` tags
2. **No `NPM_TOKEN` secret** is required for the default OIDC workflow.

## Workflow behavior

| Trigger | Behavior |
| --- | --- |
| Push tag `v*` | Runs validate + publish (after `npm` environment approval) + verify-registry |
| `workflow_dispatch` | `publish=false` (default): validate only. `publish=true`, `dry_run=true`: OIDC dry-run behind `npm` gate. `publish=true`, `dry_run=false`: real publish |

**Toolchain:** Node `22.14`, npm `11.5.1+` (Trusted Publishing minimum).

**Validate job:** lint, typecheck, test, build, `widget:check`, `packages:verify`, `packages:verify-install`, workflow meta-check, tarball artifacts.

**Publish job guards:**

- Repository must be `master-tecs/chatai`
- Ref must be `main` or a `v*` tag
- Tag must match `VERSION` on tag pushes
- Package versions must match `VERSION` (`sync-package-versions --check`)
- Duplicate npm versions are rejected before upload

**Publish order:**

1. `@nightzeros/chatai-widget-core`
2. `@nightzeros/chatai-widget`
3. `@nightzeros/chatai-react`
4. `@nightzeros/chatai-sdk`

Each publish uses `npm publish --access public --provenance` **in GitHub Actions only**. No `--force`.

## Provenance

- Source `package.json` files keep `"publishConfig": { "access": "public" }` only.
- Provenance is added by [`scripts/publish-npm-packages.mjs`](../../scripts/publish-npm-packages.mjs) when `--publish` runs in GitHub Actions.
- Local `--dry-run` does **not** use provenance (avoids `provider: null` errors outside CI).

## Local verification (before release)

```bash
pnpm packages:sync-versions
node scripts/sync-package-versions.mjs --check
pnpm packages:build
pnpm packages:verify
pnpm packages:verify-install
pnpm packages:publish:dry-run
pnpm ci:npm-publish
```

Dry-run does not upload and does not require npm OTP. It may run while the current `VERSION` already exists on npm (duplicate check runs only on `--publish`).

## Version sync

Root [`VERSION`](../../VERSION) is canonical:

```bash
pnpm packages:sync-versions          # write package.json versions
node scripts/sync-package-versions.mjs --check   # verify without writing
```

## Post-publish verification

After a successful OIDC release, CI runs:

```bash
pnpm packages:verify-registry
```

This checks npm registry versions, `latest` dist-tags, dependency metadata, and installs `@nightzeros/chatai-react` + `@nightzeros/chatai-sdk` from the public registry.

## Troubleshooting

| Problem | Likely cause | Action |
| --- | --- | --- |
| `already published on npm` | `VERSION` not bumped | Bump `VERSION`, sync, retag |
| OIDC / Trusted Publisher failure | npm publisher config mismatch | Verify owner/repo/workflow/environment on each package |
| Environment not approved | `npm` gate waiting | Approve in GitHub Actions environment |
| Partial publish (N of 4 live) | Mid-run failure | Do **not** republish successful packages; fix blocker and publish remaining packages manually or bump patch and re-release |
| Local provenance error | Running `--publish` outside CI | Use GitHub Actions; local emergency requires `ALLOW_LOCAL_NPM_PUBLISH=1` |
| Tag / VERSION mismatch | Tag pushed before version commit | Align tag and `VERSION`, push corrected tag |

## Emergency token fallback

See [`npm-publish-fallback.md`](./npm-publish-fallback.md). Disabled by default (`if: false`). Not for routine releases.

## Related

- [npm package audit](./npm-package-audit.md)
- [Release checklist](../RELEASE.md)
- [Production VPS deployment](./vps.md)
