# Release checklist (v1.x)

Use this before tagging a product release. Canonical version: root `VERSION` file. Repository: [`nightzeros/chatai`](https://github.com/nightzeros/chatai).

## One-time repository setup

These are GitHub settings, not files in the repo. Check them before every release; a `v*` tag starts publishing and deploying immediately.

- [ ] **Settings → Environments → `production`**: required reviewers configured. Without them, a tag deploys to the production VPS with no approval. **Release blocker if missing.**
- [ ] **Settings → Environments → `npm`**: exists, with required reviewers and deployment restricted to `main` and `v*` tags. If it doesn't exist, GitHub creates it unprotected on first use. **Release blocker if missing.**
- [ ] npm Trusted Publisher configured on all four `@nightzeros/chatai-*` packages (owner `nightzeros`, repository `chatai`, workflow `publish-npm.yml`, environment `npm`). See [npm-publish.md](./deployment/npm-publish.md#trusted-publisher-required-per-package).
- [ ] `main` protected: changes only through pull requests, no force pushes.
- [ ] Secret scanning, push protection and private vulnerability reporting enabled.
- [ ] GitHub Discussions enabled (linked from the README, SUPPORT and issue templates).

## What a `v*` tag triggers

| Workflow                                                        | What it does                                                                               | Gate                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [Publish npm packages](../.github/workflows/publish-npm.yml)    | Validates, then publishes the four packages with OIDC provenance and verifies the registry | `npm` environment approval                                              |
| [Release](../.github/workflows/release.yml)                     | Creates the GitHub Release from the `CHANGELOG.md` section for `VERSION`                   | None (runs immediately)                                                 |
| [Deploy Production](../.github/workflows/deploy-production.yml) | Builds `ghcr.io/nightzeros/chatai:vX.Y.Z`, then deploys it to the VPS                      | `production` environment approval, **only if reviewers are configured** |

All three refuse to run when the tag doesn't match `VERSION`.

## Pre-flight

- [ ] `VERSION` matches the intended tag (`1.1.0` → `v1.1.0`)
- [ ] `packages/sdk/src/version.ts` `API_VERSION` matches `VERSION`
- [ ] OpenAPI fingerprint up to date (`pnpm --filter @nightzeros/chatai-sdk openapi:fingerprint` only if the contract changed intentionally)
- [ ] `CHANGELOG.md` has a dated `## [X.Y.Z] - YYYY-MM-DD` section; preview features are labelled as preview
- [ ] Upgrade notes in the docs for any migration or configuration change
- [ ] Docs: API stability, versioning, environment reference and production checklist still accurate
- [ ] No secrets in the tree (`.env` untracked)

## Verification

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migrations   # requires DATABASE_URL to an empty, disposable Postgres
pnpm build
pnpm docs:build
pnpm widget:check
pnpm ci:widget-release
pnpm ci:npm-publish
node scripts/sync-package-versions.mjs --check
pnpm packages:build
pnpm packages:verify
pnpm packages:verify-install
pnpm packages:publish:dry-run
pnpm e2e
```

Never run `test:migrations` against a production database.

Optional load smoke (local server running):

```bash
BASE_URL=http://127.0.0.1:3000 ASSISTANT_ID=asst_… pnpm loadtest:smoke
```

## Branch, PR, tag

1. Create `release/vX.Y.Z` from `main`. Update `VERSION`, run `pnpm packages:sync-versions`, and write the changelog section.
2. Open a PR to `main`. Wait for CI and review, then merge. Never push directly to `main`.
3. Confirm the one-time setup above, especially the `production` and `npm` reviewers.
4. Tag the merge commit and push only the tag:

   ```bash
   git switch main && git pull --ff-only
   git tag -a v$(cat VERSION) -m "ChatAI $(cat VERSION)"
   git push origin v$(cat VERSION)
   ```

5. **Publish npm packages**: approve the `npm` environment when the publish job waits. OIDC publishes in order: widget-core → widget → react → sdk, then **verify-registry** confirms versions, dist-tags and an install smoke.
6. **Release**: check the GitHub Release body matches the changelog section.
7. **Deploy Production**: approve the `production` environment only when ready to deploy, then run the post-release smoke below.

Normal npm releases do **not** use `NPM_TOKEN`. See [docs/deployment/npm-publish.md](./deployment/npm-publish.md).

## Post-release smoke

- `GET https://app.nightzeros.com/api/health` → `{"status":"ok","db":"ok"}`
- `GET /api/v1/openapi.json` reports `info.version` matching the tag
- Sign in → open an assistant → playground chat with sources
- Embed hosted `/widget/chat.js` on an allowed origin and send a message
- Admin routes without a session return `401`
- `pnpm packages:verify-registry` (or confirm the CI verify-registry job passed)
- `pnpm add @nightzeros/chatai-react@X.Y.Z` in a clean app
- [docs.nightzeros.com](https://docs.nightzeros.com/docs) shows the new pages
- No stray or restarting containers on the VPS; app logs free of errors

## Rollback

- **App**: `CHATAI_IMAGE_TAG=<previous tag> ./scripts/rollback.sh` on the VPS. See [vps.md](./deployment/vps.md). Migrations are forward-only; older app versions ignore new tables and columns.
- **Database**: restore the pre-release backup only if data must be reverted; data written after the release is lost.
- **npm**: never unpublish. Deprecate a broken version (`npm deprecate @nightzeros/chatai-react@X.Y.Z "…"`) and ship a patch.
- **GitHub Release**: edit or mark the release; don't move or delete a pushed tag.
