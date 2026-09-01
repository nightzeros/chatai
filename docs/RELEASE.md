# Release checklist (v1.x)

Use this before tagging a product release. Canonical version: root `VERSION` file.

## Pre-flight

- [ ] `VERSION` matches intended tag (`1.0.1` → `v1.0.1`)
- [ ] `packages/sdk/src/version.ts` `API_VERSION` matches `VERSION`
- [ ] OpenAPI fingerprint up to date (`pnpm --filter @nightzeros/chatai-sdk openapi:fingerprint` only if the contract changed intentionally)
- [ ] `CHANGELOG.md` has a dated section for this version
- [ ] Docs: API stability + versioning pages still accurate
- [ ] No secrets in the tree (`.env` untracked)
- [ ] npm Trusted Publisher linked on all four `@nightzeros/chatai-*` packages
- [ ] GitHub environment **`npm`** has required reviewers

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migrations   # requires DATABASE_URL to empty/fresh Postgres
pnpm build
pnpm docs:build
pnpm widget:check
pnpm ci:widget-release
pnpm ci:npm-publish
pnpm packages:sync-versions
node scripts/sync-package-versions.mjs --check
pnpm packages:build
pnpm packages:verify
pnpm packages:verify-install
pnpm packages:publish:dry-run
pnpm e2e
```

Optional load smoke (local server running):

```bash
BASE_URL=http://127.0.0.1:3000 ASSISTANT_ID=asst_… pnpm loadtest:smoke
```

## Tag and publish (npm via OIDC)

1. Merge release-ready changes into `main`.
2. Update `VERSION` and run `pnpm packages:sync-versions`; commit on `main`.
3. Tag: `git tag -a v$(cat VERSION) -m "ChatAI $(cat VERSION)"`
4. Push: `git push origin main --tags`
5. GitHub Actions **Publish npm packages** runs validation.
6. Approve the **`npm`** environment when the publish job waits.
7. OIDC publishes `@nightzeros/chatai-*` in order: widget-core → widget → react → sdk.
8. CI **verify-registry** job confirms npm versions, dist-tags, and registry install smoke.
9. Create GitHub Release from the tag (notes from `CHANGELOG.md`) — see [`.github/workflows/release.yml`](../.github/workflows/release.yml).

Normal npm releases do **not** use `NPM_TOKEN`. See [docs/deployment/npm-publish.md](./deployment/npm-publish.md).

## Post-release smoke

- Fresh `docker compose up --build` → `GET /api/health` ok
- Sign up → create assistant → upload knowledge → playground chat
- Embed hosted `/widget/chat.js` on a sample origin
- `GET /api/v1/openapi.json` reports `info.version` matching the tag
- `pnpm packages:verify-registry` (or confirm CI verify-registry job passed)
- `pnpm add @nightzeros/chatai-react` in a clean app
