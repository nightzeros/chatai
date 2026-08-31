# Contributing to ChatAI

Thanks for your interest in contributing. ChatAI is at **v1.0** — the public `/api/v1` API and schema migration path are stable. ChatAI is maintained by [NightZeros](https://nightzeros.com). Small, focused PRs are preferred.

Please read the [Code of Conduct](./CODE_OF_CONDUCT.md) and [Security Policy](./SECURITY.md).

## Development setup

1. Prerequisites: Node.js 20+ (22 recommended), pnpm 10+. Docker is optional if you use Neon.

2. Clone and install:

```bash
git clone https://github.com/master-tecs/chatai.git
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

- `apps/web` — Next.js dashboard and APIs
- `apps/docs` — Fumadocs documentation site
- `packages/database` — Drizzle schema and migrations
- `packages/ai` — LLM / embedding wrappers
- `packages/rag` — ingestion and retrieval pipelines
- `packages/sdk` — OpenAPI + TypeScript client
- `packages/widget` / `widget-core` / `react` — embeddable chat UI

## Coding standards

- TypeScript strict mode; prefer explicit types at package boundaries.
- Use Prettier (`pnpm format`) and ESLint (`pnpm lint`).
- Keep changes scoped to the task; avoid drive-by refactors.
- Do not commit secrets (`.env`, API keys).
- **API changes:** update OpenAPI in `@nightzeros/chatai-sdk` and regenerate the fingerprint (`pnpm --filter @nightzeros/chatai-sdk openapi:fingerprint`) when routes change. See [API stability](./apps/docs/content/docs/api/stability.mdx).
- **Schema changes:** additive migrations for minor/patch; breaking DDL only in majors. See [versioning docs](./apps/docs/content/docs/self-hosting/versioning.mdx).

## Pull requests

1. Open an issue first for larger features (or start a [Discussion](https://github.com/master-tecs/chatai/discussions)).
2. Create a branch from `main`.
3. Ensure `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
4. Fill out the PR template (include semver impact).

Good first issues are labeled [`good first issue`](https://github.com/master-tecs/chatai/labels/good%20first%20issue).

## Reporting bugs

Use the Bug Report issue template and include steps to reproduce, expected vs actual behavior, and environment details. Security issues → [SECURITY.md](./SECURITY.md).

## Roadmap

See [ROADMAP.md](./ROADMAP.md).
