# Contributing to ChatAI

Thanks for your interest in contributing. ChatAI is at **v1.1 (public preview)**: the public `/api/v1` API, widget embed and schema migration path are stable within major version 1, while Voice is still a preview feature. ChatAI is maintained by [NightZeros](https://nightzeros.com). Small, focused PRs are preferred.

Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) and [Security Policy](./SECURITY.md).

## Development setup

1. Prerequisites: Node.js 20+ (22 recommended), pnpm 10+. Docker is optional if you use Neon.

2. Clone and install:

```bash
git clone https://github.com/nightzeros/chatai.git
cd chatai
cp .env.example .env
pnpm install
```

3. Database — pick one:

- **Neon (recommended for cloud/dev):** set `DATABASE_URL` to the pooled connection string and `DATABASE_URL_UNPOOLED` to the direct (non-pooler) URL from the Neon console.
- **Local Docker:** `docker compose up -d db` and use the default local URL from `.env.example`.

4. Apply migrations and run:

```bash
pnpm db:migrate
pnpm dev
```

The dashboard is at [http://localhost:3000](http://localhost:3000).

## Monorepo layout

- `apps/web` — Next.js dashboard and APIs, including Voice sessions (`src/lib/voice`) and hosted usage and billing (`src/lib/hosting`)
- `apps/docs` — Fumadocs documentation site ([docs.nightzeros.com](https://docs.nightzeros.com))
- `packages/database` — Drizzle schema and migrations
- `packages/ai` — LLM / embedding wrappers
- `packages/rag` — ingestion, retrieval, and the answer pipeline (scope policy, output guard)
- `packages/sdk` — OpenAPI + TypeScript client (published as `@nightzeros/chatai-sdk`)
- `packages/widget-core` / `widget` / `react` — embeddable chat UI (published as `@nightzeros/chatai-widget-core`, `-widget`, `-react`)

## Tests

| Command                        | What it covers                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                    | Unit and integration tests (Vitest) across the monorepo                                                                                  |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint                                                                                                                    |
| `pnpm test:migrations`         | Applies every migration to a fresh Postgres (needs `DATABASE_URL`)                                                                       |
| `pnpm widget:check`            | Hosted widget bundle exists and stays within its 30 KB gzip budget (run after `pnpm build`)                                              |
| `pnpm packages:verify`         | Packs the npm packages and audits the tarballs                                                                                           |
| `pnpm e2e`                     | Playwright end-to-end tests (see `.env.e2e` in the [environment reference](https://docs.nightzeros.com/docs/self-hosting/env-reference)) |
| `pnpm docs:build`              | Builds the documentation site                                                                                                            |

Voice tests run against `VOICE_PROVIDER=mock` and never need provider credentials. Don't weaken or skip a test to make a change pass; fix the code or explain the behavior change in the PR.

## Coding standards

- TypeScript strict mode; prefer explicit types at package boundaries.
- Use Prettier (`pnpm format`) and ESLint (`pnpm lint`).
- Keep changes scoped to the task; avoid drive-by refactors.
- Do not commit secrets (`.env`, API keys).
- **API changes:** update OpenAPI in `@nightzeros/chatai-sdk` and regenerate the fingerprint (`pnpm --filter @nightzeros/chatai-sdk openapi:fingerprint`) when routes change. See [API stability](./apps/docs/content/docs/api/stability.mdx).
- **Schema changes:** additive migrations for minor/patch; breaking DDL only in majors. See [versioning docs](./apps/docs/content/docs/self-hosting/versioning.mdx).
- **New environment variables:** add them to `apps/web/src/lib/env.ts`, `.env.example`, and the [environment reference](./apps/docs/content/docs/self-hosting/env-reference.mdx).
- **User-facing changes:** add an entry to [CHANGELOG.md](./CHANGELOG.md) under an `## [Unreleased]` heading at the top (create it if it isn't there).
- **Voice and billing:** never expose plan, billing or usage details to widget visitors, and never send provider keys to the browser.

## Pull requests

1. Open an issue first for larger features (or start a [Discussion](https://github.com/nightzeros/chatai/discussions)).
2. Create a branch from `main`.
3. Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
4. Fill out the PR template (include semver impact).

Good first issues are labeled [`good first issue`](https://github.com/nightzeros/chatai/labels/good%20first%20issue).

## Reporting bugs

Use the Bug Report issue template and include steps to reproduce, expected vs actual behavior, and environment details. Security issues → [SECURITY.md](./SECURITY.md).

## Releases

Maintainers cut releases from a release branch through a PR to `main`, then push a `v*` tag. See [docs/RELEASE.md](./docs/RELEASE.md).

## Getting help

See [SUPPORT.md](./SUPPORT.md).

## Roadmap

See [ROADMAP.md](./ROADMAP.md).

## License

Contributions are licensed under the [Apache License 2.0](./LICENSE).
