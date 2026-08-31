# Release checklist (v1.x)

Use this before tagging a product release. Canonical version: root `VERSION` file.

## Pre-flight

- [ ] `VERSION` matches intended tag (`1.0.0` → `v1.0.0`)
- [ ] `packages/sdk/src/version.ts` `API_VERSION` matches `VERSION`
- [ ] OpenAPI fingerprint up to date (`pnpm --filter @nightzeros/chatai-sdk openapi:fingerprint` only if the contract changed intentionally)
- [ ] `CHANGELOG.md` has a dated section for this version
- [ ] Docs: API stability + versioning pages still accurate
- [ ] No secrets in the tree (`.env` untracked)

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migrations   # requires DATABASE_URL to empty/fresh Postgres
pnpm build
pnpm docs:build
pnpm widget:check
pnpm ci:widget-release # meta-check that CI gates stay wired
pnpm packages:sync-versions
pnpm packages:build
pnpm packages:verify
pnpm packages:verify-install
pnpm e2e
```

Optional load smoke (local server running):

```bash
BASE_URL=http://127.0.0.1:3000 ASSISTANT_ID=asst_… pnpm loadtest:smoke
```

## Tag and publish

1. Commit release notes / version bumps on `main` (or merge the release PR).
2. Tag: `git tag -a v$(cat VERSION) -m "ChatAI $(cat VERSION)"`
3. Push: `git push origin main --tags`
4. Create GitHub Release from the tag (notes from `CHANGELOG.md`).
5. **npm client packages** (when ready — see [docs/deployment/npm-publish.md](./deployment/npm-publish.md)):
   - Complete npm Trusted Publisher linking for `@nightzeros/chatai-widget-core`, `@nightzeros/chatai-widget`, `@nightzeros/chatai-react`, `@nightzeros/chatai-sdk`
   - Configure GitHub environment **`npm`** with required reviewers
   - After tag push: review `publish-npm.yml` artifacts (packed tarballs)
   - Approve publish via `workflow_dispatch` (`publish=true`) or the tag-triggered `npm` environment gate
   - Publish order: widget-core → widget → react → sdk (same `VERSION` as the git tag)
   - Smoke test: `pnpm add @nightzeros/chatai-react` in a clean app pointing at your production origin

## Post-release smoke

- Fresh `docker compose up --build` → `GET /api/health` ok
- Sign up → create assistant → upload knowledge → playground chat
- Embed hosted `/widget/chat.js` on a sample origin
- `GET /api/v1/openapi.json` reports `info.version` matching the tag
