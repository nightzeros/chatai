# ChatAI

Open-source platform to **create an AI assistant, give it your knowledge, test it, customize it, and embed it on your website**.

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
| `BETTER_AUTH_URL` | Public app URL (`http://localhost:3000` locally; production origin browsers use for this instance) |
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
apps/web              Dashboard + APIs + hosted /widget/chat.js
packages/database     Schema, migrations, DB client
packages/ai           LLM + embeddings
packages/rag          Ingestion + answering
packages/evals        Offline/online eval scoring + run details
packages/sdk          TypeScript REST client + OpenAPI document

packages/widget-core  Browser-safe chat client + config loading
packages/widget       Preact Shadow DOM bundle (IIFE chat.js)
packages/react        Thin React wrapper (private workspace package)
examples/html-widget  Hosted + self-host script fixtures
examples/react-widget Vite demo using workspace:* @chatai/react
examples/node-sdk-chat Node script using workspace:* @chatai/sdk
```

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

## React workspace integration

`@chatai/react` is a **private workspace package**. It is not published to npm yet. Install it only inside this monorepo with a `workspace:*` dependency (see [`examples/react-widget/`](./examples/react-widget/)):

```json
{
  "dependencies": {
    "@chatai/react": "workspace:*"
  }
}
```

```tsx
import { ChatWidget } from "@chatai/react";

export function SupportChat() {
  return (
    <ChatWidget
      assistantId="asst_your_public_id"
      apiUrl="https://your-chatai-instance.example"
    />
  );
}
```

Do not run `pnpm add @chatai/react` from the public registry until the package is published. React 18 or 19 is required as a peer dependency.

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

`@chatai/sdk` is a **private workspace package** (not on npm). It wraps the Bearer REST API and dual-auth chat stream.

```ts
import { ChatAI } from "@chatai/sdk";

const client = new ChatAI({
  apiKey: process.env.CHATAI_API_KEY!,
  baseUrl: "http://localhost:3000",
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
- Domain allowlists and visitor rate limits are deferred to **v0.8**. Per-key REST rate limits are in v0.6.
- v0.2 keeps the existing open CORS posture on the public chat APIs so cross-origin embeds work. Host pages still need a correct absolute API origin (`script` URL or `data-api-url` / `apiUrl`).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Launcher never appears | Script URL 404, blocked script, or wrong path (expect `/widget/chat.js` on the ChatAI origin) |
| Launcher appears, chat fails | Self-host without `data-api-url`, or `data-api-url` / React `apiUrl` pointed at the wrong origin |
| CORS errors in the console | API origin mismatch, or a reverse proxy stripping CORS headers on `/api/v1/*` |
| Styling / settings look wrong | Unsaved Customize draft, or embed still caching an old `chat.js` copy |
| `Cannot find package '@chatai/react'` / `@chatai/sdk` | Packages are private; use `workspace:*` inside this monorepo until npm publish |
| Embedding model save rejected | Model native dimensions differ from instance `EMBEDDING_DIMENSIONS` (default 1536) |
| REST `401` / `403` | Missing Bearer `sk_` key, revoked key, or missing scope |
| REST `429` | Per-key rate limit; wait for `Retry-After` seconds |
| Eval run details show empty retrieval / unknown sources on new runs | The background eval worker may be running stale code after HMR; **restart `pnpm dev`** after changes under `packages/evals`. New runs should persist `details.snapshot.retrieval` on every score row. |

## v0.6 status

Developer platform:

- Provider registry (OpenAI, Anthropic, Gemini, OpenRouter, Azure, Ollama, Groq, OpenAI-compatible; embeddings: OpenAI, Cohere, Voyage)
- Per-assistant chat/embedding overrides when embedding dimensions match the instance
- Hashed API keys, scoped Bearer REST, Postgres per-key rate limits
- Dual-auth chat: widget `publicId` stays keyless; SDK uses `sk_` + `chat` scope
- OpenAPI at `/api/v1/openapi.json`, private `@chatai/sdk`, `examples/node-sdk-chat`

Next: v0.7 example apps / docs site; npm publish of packages; v0.8 domain allowlists and visitor rate limits.

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

- Hosted `/widget/chat.js`, self-host copy + `data-api-url`, private `@chatai/react` wrapper  
- Customize settings with draft preview and Install snippets  
- Example fixtures under `examples/`  

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
