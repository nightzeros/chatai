# Contributing to ChatAI

Thanks for your interest in contributing. This project is early (v0.1) — small, focused PRs are preferred.

## Development setup

1. Prerequisites: Node.js 20+ (22 recommended), pnpm 10+. Docker is optional if you use Neon.

2. Clone and install:

```bash
git clone <repo-url>
cd chatAI
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
- `packages/database` — Drizzle schema and client
- `packages/ai` — LLM / embedding wrappers
- `packages/rag` — ingestion and retrieval pipelines

## Coding standards

- TypeScript strict mode; prefer explicit types at package boundaries.
- Use Prettier (`pnpm format`) and ESLint (`pnpm lint`).
- Keep changes scoped to the task; avoid drive-by refactors.
- Do not commit secrets (`.env`, API keys).

## Pull requests

1. Open an issue first for larger features.
2. Create a branch from `main`.
3. Ensure `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass.
4. Fill out the PR template with summary and test plan.

## Reporting bugs

Use the Bug Report issue template and include steps to reproduce, expected vs actual behavior, and environment details.
