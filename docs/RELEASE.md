# Release checklist (v1.x)

Use this before tagging a product release. Canonical version: root `VERSION` file.

## Pre-flight

- [ ] `VERSION` matches intended tag (`1.0.0` → `v1.0.0`)
- [ ] `packages/sdk/src/version.ts` `API_VERSION` matches `VERSION`
- [ ] OpenAPI fingerprint up to date (`pnpm --filter @chatai/sdk openapi:fingerprint` only if the contract changed intentionally)
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
5. When npm publish is enabled: publish `@chatai/sdk`, `@chatai/widget`, `@chatai/react` at the same version.

## Post-release smoke

- Fresh `docker compose up --build` → `GET /api/health` ok
- Sign up → create assistant → upload knowledge → playground chat
- Embed hosted `/widget/chat.js` on a sample origin
- `GET /api/v1/openapi.json` reports `info.version` matching the tag
