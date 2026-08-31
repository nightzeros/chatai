# ChatAI

[![CI](https://github.com/master-tecs/chatai/actions/workflows/ci.yml/badge.svg)](https://github.com/master-tecs/chatai/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-0F766E.svg)](./VERSION)

Open-source AI assistants grounded in your knowledge.

An [NightZeros](https://nightzeros.com) open-source project · [Product site](https://nightzeros.com/chatai)

**v1.0** freezes the public `/api/v1` API and migration path. See [ROADMAP.md](./ROADMAP.md), [CHANGELOG.md](./CHANGELOG.md), and [docs/RELEASE.md](./docs/RELEASE.md).

## What it does

1. Create an assistant with instructions and a welcome message  
2. Upload PDFs, text, Markdown, DOCX, CSV, HTML, JSON, or FAQs — or crawl a website  
3. Ask questions in the playground — get RAG answers with citations  
4. Customize appearance and install a `<script>` widget (v0.2+)  
5. Review owner-only conversation transcripts, feedback, and all-time answer analytics (v0.3+)
6. Turn recurring unanswered questions into queued FAQ knowledge from Analytics
7. Tune retrieval with **hybrid vector + keyword search**, reranking, and query expansion (v0.5+)
8. Run **offline eval regressions** and optional online quality sampling with LLM-as-judge scorers (v0.5+)
9. Swap LLM/embedding providers, issue hashed API keys, and call a public REST API + TypeScript SDK (v0.6+)


Hallucination modes (Strict / Balanced / Flexible), answer guardrails with citation verification, and an owner-only RAG debug panel are available. Per-assistant RAG settings control hybrid search, reranking, chunking mode, and eval sample rate.

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

Or for a throwaway Docker demo only:

```bash
# in .env: SEED_DEMO_ON_START=1
docker compose up --build
```

Then sign in, open the Support Bot playground, and ask about refunds (once `AI_API_KEY` is set and ingestion finishes).

### Offline / local models (Ollama)

Run Postgres + the app + [Ollama](https://ollama.com) with the Compose `local-models` profile:

```bash
cp .env.example .env
# Prefer hybrid: AI_PROVIDER=ollama + keep 1536-d embeddings (see .env.example)

docker compose --profile local-models up --build
docker compose --profile local-models exec ollama ollama pull llama3.2
```

Ollama listens on [http://localhost:11434](http://localhost:11434). Inside Compose use `OLLAMA_BASE_URL=http://ollama:11434/v1`.

**Note:** Fully local `nomic-embed-text` (768-d) does not match the fixed `vector(1536)` schema — ingest fails. Use Ollama for **chat** and keep 1536-d embeddings, or see the docs.

GPU is optional; CPU Ollama works but is slow. Skip the profile smoke in CI/environments without the models pulled.

Docs: [Local models (Ollama)](./apps/docs/content/docs/self-hosting/ollama.mdx) (site: `pnpm docs:dev` → Self-hosting).

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
| `BETTER_AUTH_URL` | Public app URL (`http://localhost:3000` locally; production origin browsers use for this instance) |
| `RESEND_API_KEY` | Optional; send password-reset emails via Resend. Without it, reset links are logged to the server console |
| `EMAIL_FROM` | Optional Resend from address (e.g. `ChatAI <noreply@yourdomain.com>`) |
| `AI_API_KEY` | OpenAI-compatible API key for chat + embeddings (default provider) |
| `AI_PROVIDER` | Chat provider id (`openai`, `openai-compatible`, `anthropic`, `google`, `openrouter`, `azure`, `ollama`, `groq`) |
| `AI_MODEL` / `AI_BASE_URL` | Default chat model and OpenAI-compatible base URL |
| `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE`, `OLLAMA_BASE_URL` | Credentials for non-OpenAI chat providers |
| `EMBEDDING_PROVIDER` | Embedding provider (`openai`, `openai-compatible`, `cohere`, `voyage`) |
| `EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` | Embedding model and **instance-wide** vector width (default `1536`; must match `chunks.embedding`) |
| `VOYAGE_API_KEY` | Voyage embeddings |
| `COHERE_API_KEY` | Optional Cohere rerank + Cohere embeddings |
| `API_RATE_LIMIT_PER_MINUTE` | Per-API-key REST rate limit (default `60`; widget chat is not limited here) |

| `UPLOAD_DIR` | Uploaded files directory (`./uploads` locally, `/app/uploads` in Docker) |

See [.env.example](./.env.example) for all options. Widget embeds should use the same absolute origin as `BETTER_AUTH_URL` (for example `https://your-chatai-instance.example`).

### Password reset

Sign-in includes **Forgot password?** (`/forgot-password`). With `RESEND_API_KEY` set, ChatAI emails a one-hour reset link. Without it, the link is logged on the server (`[email] RESEND_API_KEY not set…`) so local/self-host operators can still recover accounts. Successful resets revoke other sessions.

## Database

- **Neon** (cloud/dev): pgvector enabled; use pooled `DATABASE_URL` and direct `DATABASE_URL_UNPOOLED` for migrations.  
- **Docker Compose**: `db` + `app` services; app overrides `DATABASE_URL` to `db:5432` internally. Optional `ollama` via `--profile local-models`.

```bash
pnpm db:generate   # create migration from schema changes
pnpm db:migrate    # apply migrations (drizzle-kit)
pnpm migrate       # apply migrations (runtime script, used in Docker)
pnpm db:studio     # Drizzle Studio
```

## Monorepo

```text
app.nightzeros.com        Hosted ChatAI API + zero-install /widget/chat.js
docs.nightzeros.com       Documentation site

apps/web                  Dashboard + APIs + hosted /widget/chat.js
apps/docs                 Documentation site (Fumadocs) — pnpm docs:dev → :3001
packages/database         Schema, migrations, DB client
packages/ai               LLM + embeddings
packages/rag              Ingestion + answering
packages/evals            Offline/online eval scoring + run details
packages/sdk              Public npm: Node REST + SSE client + OpenAPI

packages/widget-core      Public npm: browser-safe chat client + config loading
packages/widget           Public npm: Preact mount API; IIFE chat.js for hosted embed
packages/react            Public npm: React / Next.js <ChatWidget />
examples/html-widget      Hosted + self-host script fixtures
examples/react-widget     Vite demo (@chatai/react from workspace or npm)
examples/nextjs-portfolio App Router portfolio + @chatai/react
examples/node-sdk-chat    Node script using @chatai/sdk
```

Public install (hosted API at `https://app.nightzeros.com`):

```bash
pnpm add @chatai/react    # React / Next.js embed
pnpm add @chatai/sdk      # Node server client
# Zero-install browser embed: load https://app.nightzeros.com/widget/chat.js
```

Inside this monorepo, use `workspace:*` until you cut a release tag. See [docs/deployment/npm-publish.md](./docs/deployment/npm-publish.md).

## Embed the widget

Primary install path: load the hosted IIFE from your ChatAI deployment. The widget derives the API origin from the script URL, so you do not set `data-api-url` for the hosted case.

```html
<script
  src="https://your-chatai-instance.example/widget/chat.js"
  data-assistant-id="asst_your_public_id"
  async
></script>
```

Locally, swap the origin for `http://localhost:3000`. Copy the exact tag from the assistant **Install** tab after you create an assistant. Runnable fixtures live in [`examples/html-widget/`](./examples/html-widget/).

Browser baseline: modern evergreen browsers with Shadow DOM and `fetch` / streaming (`ReadableStream`) support (current Chrome, Firefox, Safari, and Edge).

## Self-host `chat.js`

Copy the same built file your instance serves at `/widget/chat.js` onto your static origin. Point `data-api-url` at the ChatAI API origin so chat still reaches this deployment:

```html
<script
  src="https://static.example.com/chat.js"
  data-assistant-id="asst_your_public_id"
  data-api-url="https://your-chatai-instance.example"
  async
></script>
```

From this repo you can prepare the HTML example copy with:

```bash
pnpm examples:prepare-widget
```

That writes `examples/html-widget/chat.js` for [`examples/html-widget/self-host.html`](./examples/html-widget/self-host.html).

If `data-api-url` is missing or points at a different origin than the ChatAI API, the launcher may mount while config and chat requests fail (wrong host, CORS, or 404). The script host and the API host are independent when you self-host the bundle.

## React integration

Install from npm (or `workspace:*` while developing in this monorepo):

```bash
pnpm add @chatai/react
```

```tsx
"use client";

import { ChatWidget } from "@chatai/react";

export function SupportChat() {
  return (
    <ChatWidget
      assistantId="asst_your_public_id"
      apiUrl="https://app.nightzeros.com"
    />
  );
}
```

React 18 or 19 is required as a peer dependency. The package ships with a `"use client"` entry for Next.js App Router.

## Providers and model overrides

Instance defaults come from env (`AI_PROVIDER`, `AI_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`). Missing credentials for the selected provider return **503** (`provider X is not configured on this instance`).

Each assistant can override chat/embedding provider and model in **Settings**. Overrides store **no API keys** — they use the instance env keys. Changing the embedding model reprocesses all documents.

**Vector width is instance-global.** `chunks.embedding` is `vector(1536)` and must match `EMBEDDING_DIMENSIONS`. Settings reject embedding models whose native size differs (for example Cohere `embed-english-v3.0` at 1024). Mixed dimensions are out of scope.

## API keys and REST

Create and revoke keys under **Account**. Secrets use an `sk_live_` prefix, are hashed at rest (SHA-256), and the plaintext is shown **once**. Scopes: `chat`, `assistants:read/write`, `documents:read/write`, `conversations:read`, `analytics:read`.

Bearer-only owner routes live under `/api/v1` (assistants CRUD, documents list/get/delete/reprocess, conversations, analytics). Document **upload** stays dashboard-only. Per-key Postgres rate limiting returns `429` with `Retry-After`.

`POST /api/v1/chat` accepts:

- Widget / playground: `publicId` in the body, **no API key**
- SDK / REST: `Authorization: Bearer sk_…` with the `chat` scope; the assistant must belong to the key owner

OpenAPI: `GET /api/v1/openapi.json`.

## TypeScript SDK

Install from npm (server-side only — never expose `sk_` keys in the browser):

```bash
pnpm add @chatai/sdk
```

```ts
import { ChatAI } from "@chatai/sdk";

const client = new ChatAI({
  apiKey: process.env.CHATAI_API_KEY!,
  baseUrl: process.env.CHATAI_API_URL ?? "https://app.nightzeros.com",
});

const result = await client.chat({
  assistantId: "asst_your_public_id",
  message: "What is your refund policy?",
  onToken: (text) => process.stdout.write(text),
});
```

Create keys in **Account** (scopes, shown once). OpenAPI: `GET /api/v1/openapi.json`. Runnable example: [`examples/node-sdk-chat/`](./examples/node-sdk-chat/).

## Customize settings

In the dashboard **Customize** tab you can set:

| Setting | Values |
| --- | --- |
| Accent / primary color | 6-digit hex (`#112233`) |
| Position | `bottom-left` or `bottom-right` |
| Theme | `light`, `dark`, or `system` |
| Icon URL | HTTPS URL, or empty for default |
| Suggested questions | Up to 5 short prompts |
| Show sources | Whether citation chips appear after answers |

Draft changes update the live preview immediately; only **Save** publishes them to the public embed config.

## Security and CORS

- `publicId` / `data-assistant-id` is a **public capability**, not a secret. Anyone who knows it can open the widget and chat against that assistant.
- Widget and playground chat stay **keyless**. Hashed `sk_` keys are for owner REST/SDK only.
- Domain allowlists, visitor rate limits, signed widgets, and privacy retention are available in **v0.8+ / v1.0**.
- Host pages still need a correct absolute API origin (`script` URL or `data-api-url` / `apiUrl`).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Launcher never appears | Script URL 404, blocked script, or wrong path (expect `/widget/chat.js` on the ChatAI origin) |
| Launcher appears, chat fails | Self-host without `data-api-url`, or `data-api-url` / React `apiUrl` pointed at the wrong origin |
| CORS errors in the console | API origin mismatch, or a reverse proxy stripping CORS headers on `/api/v1/*` |
| Styling / settings look wrong | Unsaved Customize draft, or embed still caching an old `chat.js` copy |
| `Cannot find package '@chatai/react'` / `@chatai/sdk` | Run `pnpm install`; in this monorepo use `workspace:*`, or `pnpm add @chatai/react` / `@chatai/sdk` from npm after publish |
| Embedding model save rejected | Model native dimensions differ from instance `EMBEDDING_DIMENSIONS` (default 1536) |
| REST `401` / `403` | Missing Bearer `sk_` key, revoked key, or missing scope |
| REST `429` | Per-key rate limit; wait for `Retry-After` seconds |
| Eval run details show empty retrieval / unknown sources on new runs | The background eval worker may be running stale code after HMR; **restart `pnpm dev`** after changes under `packages/evals`. New runs should persist `details.snapshot.retrieval` on every score row. |

## v1.0 status

Stabilization and release:

- `/api/v1` contract freeze (OpenAPI fingerprint + stability docs)
- Semver + forward-only migration guarantees (`VERSION`, `pnpm test:migrations`)
- Widget hardening (30 kB gzip CI budget, offline retry UX, e2e)
- Load-test smoke harness (`pnpm loadtest:*`)
- Community: Discussions, labels, roadmap, SECURITY, CoC, release workflow

## v0.8 status

Security + privacy:

- Domain allowlist, visitor/assistant rate limits, optional widget signing
- Encrypted provider secrets, audit log, conversation retention/export/delete

## v0.7 status

Self-hosting, documentation site, and example apps:

- Docker: Drizzle migrate on boot, `GET /api/health`, Compose healthchecks
- Optional Compose profile `local-models` (Ollama) — hybrid chat recommended; 768-d local embeddings not schema-compatible yet
- Optional `SEED_DEMO_ON_START=1` for demo seed after health (dev/demo only)
- `apps/docs` Fumadocs site (`pnpm docs:dev` on :3001) — install, self-hosting, product, API (Scalar), SDK
- Examples: html-widget, react-widget, nextjs-portfolio, node-sdk-chat; support-bot walkthrough via `pnpm seed:demo`

Next: first npm release of `@chatai/*` client packages ([docs/deployment/npm-publish.md](./docs/deployment/npm-publish.md)); post-1.0 features in [ROADMAP.md](./ROADMAP.md).

## v0.6 status

Developer platform:

- Provider registry (OpenAI, Anthropic, Gemini, OpenRouter, Azure, Ollama, Groq, OpenAI-compatible; embeddings: OpenAI, Cohere, Voyage)
- Per-assistant chat/embedding overrides when embedding dimensions match the instance
- Hashed API keys, scoped Bearer REST, Postgres per-key rate limits
- Dual-auth chat: widget `publicId` stays keyless; SDK uses `sk_` + `chat` scope
- OpenAPI at `/api/v1/openapi.json`, `@chatai/sdk`, `examples/node-sdk-chat`

## v0.5 status

RAG quality and evaluation tooling:

- Hybrid retrieval (pgvector + `tsvector` with RRF fusion), LLM reranking, optional Cohere rerank
- Query expansion for short/ambiguous questions; parent/child chunking mode (opt-in, reprocess to activate)
- Answer verifier with one regenerate attempt; guardrails toggles on Settings
- `packages/evals` with faithfulness, relevance, and citation scorers
- Offline eval sets + regression runs; AI Quality section on Analytics; eval run drill-down with retrieved context
- Public `/api/v1/chat` contract unchanged for widget consumers


## v0.2 status

Widget delivery is in place:

- Hosted `/widget/chat.js`, self-host copy + `data-api-url`, `@chatai/react` npm package  
- Customize settings with draft preview and Install snippets  
- Example fixtures under `examples/`  

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
