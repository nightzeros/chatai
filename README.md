# ChatAI

Open-source platform to **create an AI assistant, give it your knowledge, test it, customize it, and embed it on your website**.

## What it does

1. Create an assistant with instructions and a welcome message  
2. Upload PDFs, text, Markdown, DOCX, CSV, HTML, JSON, or FAQs — or crawl a website  
3. Ask questions in the playground — get RAG answers with citations  
4. Customize appearance and install a `<script>` widget (v0.2+)  
5. Review owner-only conversation transcripts, feedback, and all-time answer analytics (v0.3+)
6. Turn recurring unanswered questions into queued FAQ knowledge from Analytics

Hallucination modes (Strict / Balanced / Flexible) and a RAG debug panel are available. Hybrid search, evaluations, and developer APIs are planned next.

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
| `AI_API_KEY` | OpenAI-compatible API key for chat + embeddings |
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
packages/widget-core  Browser-safe chat client + config loading
packages/widget       Preact Shadow DOM bundle (IIFE chat.js)
packages/react        Thin React wrapper (private workspace package)
examples/html-widget  Hosted + self-host script fixtures
examples/react-widget Vite demo using workspace:* @chatai/react
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
- Domain allowlists, request signing, and rate limits are deferred to **v0.8**.
- v0.2 keeps the existing open CORS posture on the public chat APIs so cross-origin embeds work. Host pages still need a correct absolute API origin (`script` URL or `data-api-url` / `apiUrl`).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Launcher never appears | Script URL 404, blocked script, or wrong path (expect `/widget/chat.js` on the ChatAI origin) |
| Launcher appears, chat fails | Self-host without `data-api-url`, or `data-api-url` / React `apiUrl` pointed at the wrong origin |
| CORS errors in the console | API origin mismatch, or a reverse proxy stripping CORS headers on `/api/v1/*` |
| Styling / settings look wrong | Unsaved Customize draft, or embed still caching an old `chat.js` copy |
| `Cannot find package '@chatai/react'` | Package is private; use `workspace:*` inside this monorepo until npm publish |

## v0.2 status

Widget delivery is in place:

- Hosted `/widget/chat.js`, self-host copy + `data-api-url`, private `@chatai/react` wrapper  
- Customize settings with draft preview and Install snippets  
- Example fixtures under `examples/`  

Next: broader dashboard coverage, npm publish of packages, and v0.8 domain allowlists / rate limits.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE)
