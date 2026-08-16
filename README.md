# ChatAI

Open-source platform to **create an AI assistant, give it your knowledge, test it, customize it, and embed it on your website**.

## What it does

1. Create an assistant with instructions and a welcome message  
2. Upload PDFs, text, Markdown, DOCX, or FAQs  
3. Ask questions in the playground — get RAG answers with citations  
4. Customize appearance and install a `<script>` widget (v0.2+)  

Hallucination modes (Strict / Balanced / Flexible), a RAG debug panel, conversations, feedback, and analytics are on the roadmap.

## Stack

- Next.js 15 + TypeScript  
- PostgreSQL + pgvector  
- Drizzle ORM  
- Better Auth  
- OpenAI-compatible LLM layer (Vercel AI SDK)  
- Tailwind CSS + shadcn/ui  
- pnpm workspaces + Turborepo  

## Quick start (Docker — self-host)

The fastest way to run everything locally with Postgres included:

```bash
cp .env.example .env
# Edit .env: set BETTER_AUTH_SECRET (openssl rand -base64 32) and AI_API_KEY

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Migrations run automatically on app startup.

Optional demo data (after the app is healthy):

```bash
pnpm seed:demo
# demo@chatai.local / DemoPass123!
```

Then sign in, open the Support Bot playground, and ask about refunds (once `AI_API_KEY` is set and ingestion finishes).

## Quick start (development)

```bash
cp .env.example .env
# DATABASE_URL — Neon pooled URL, or local Docker Postgres (see below)
# BETTER_AUTH_SECRET, AI_API_KEY

# Local Postgres only (skip if using Neon):
docker compose up -d db

pnpm install
pnpm db:migrate   # or: pnpm migrate
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection (pooled Neon URL or `postgresql://chatai:chatai@localhost:5432/chatai`) |
| `DATABASE_URL_UNPOOLED` | Direct Neon URL for migrations (optional locally) |
| `BETTER_AUTH_SECRET` | Auth signing secret (min 16 chars) |
| `BETTER_AUTH_URL` | Public app URL (`http://localhost:3000`) |
| `AI_API_KEY` | OpenAI-compatible API key for chat + embeddings |
| `UPLOAD_DIR` | Uploaded files directory (`./uploads` locally, `/app/uploads` in Docker) |

See [.env.example](./.env.example) for all options.

## Database

- **Neon** (cloud/dev): pgvector enabled; use pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` for migrations.  
- **Docker Compose**: `db` + `app` services; app overrides `DATABASE_URL` to `db:5432` internally.

```bash
pnpm db:generate   # create migration from schema changes
pnpm db:migrate    # apply migrations (drizzle-kit)
pnpm migrate       # apply migrations (runtime script, used in Docker)
pnpm db:studio     # Drizzle Studio
```

## Monorepo

```text
apps/web              Dashboard + APIs + widget hosting
packages/database     Schema, migrations, DB client
packages/ai           LLM + embeddings
packages/rag          Ingestion + answering
```

## v0.1 status

Core RAG flow is complete:

- Auth, assistant CRUD, knowledge ingestion  
- Streaming public chat API with citations + debug trace  
- Playground with sources and RAG debugger  

Next: embeddable widget (v0.2).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
