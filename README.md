<p align="center">
  <img src="./apps/web/public/icon.svg" width="72" height="72" alt="ChatAI logo" />
</p>

<h1 align="center">ChatAI</h1>

<p align="center">
  Open-source AI assistants grounded in your knowledge. Embed them anywhere.
</p>

<p align="center">
  <a href="https://github.com/nightzeros/chatai/actions/workflows/ci.yml"><img src="https://github.com/nightzeros/chatai/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@nightzeros/chatai-react"><img src="https://img.shields.io/npm/v/@nightzeros/chatai-react?label=%40nightzeros%2Fchatai-react" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <a href="https://docs.nightzeros.com/docs"><img src="https://img.shields.io/badge/docs-docs.nightzeros.com-0F766E.svg" alt="Documentation" /></a>
</p>

<p align="center">
  <a href="https://docs.nightzeros.com/docs">Documentation</a> ·
  <a href="https://app.nightzeros.com">Hosted app</a> ·
  <a href="./CHANGELOG.md">Changelog</a> ·
  <a href="./ROADMAP.md">Roadmap</a>
</p>

---

ChatAI turns your documents, websites and FAQs into an assistant that answers with citations, stays within the purpose you give it, and drops into any site as a widget, a React component or an API call. Run it yourself with Docker, or use the hosted version at [app.nightzeros.com](https://app.nightzeros.com).

ChatAI is an open-source project by [NightZeros](https://nightzeros.com). Version 1.1 is a **public preview**.

## Features

- **Embeddable chat**: a zero-install `<script>` widget, a React / Next.js component, and a REST API with a TypeScript SDK.
- **Knowledge and RAG**: upload PDF, DOCX, Markdown, CSV, HTML, JSON and text, add FAQs, or crawl a website. Hybrid vector and keyword search with reranking.
- **Grounded answers**: streaming replies with Markdown, source citations, hallucination modes (Strict / Balanced / Flexible) and an answer verifier.
- **Purpose and scope**: tell the assistant what it is for; out-of-scope requests get a short redirect instead of an off-topic answer.
- **Assistant Profile and Key Facts**: owner-reviewed facts (names, contact details, hours) suggested from your Knowledge.
- **Voice (preview)**: visitors can talk to the assistant in the same widget, with optional recording and owner playback.
- **Conversation Review**: transcripts, feedback, analytics, unanswered-question tracking, a RAG debugger, and Voice recordings where enabled.
- **Usage controls**: per-account usage metering, plan limits, rate limits, domain allowlists and signed widgets.
- **Hosted plans and billing**: plan entitlements and optional [Polar](https://polar.sh) billing for instances that sell access.
- **Bring your own models**: OpenAI, Anthropic, Google Gemini, OpenRouter, Azure OpenAI, Groq, Ollama or any OpenAI-compatible API.
- **Self-hosting**: Docker Compose with Postgres + pgvector, migrations on boot, health checks and an optional Ollama profile.

## Quick start

Requirements: Docker, or Node.js 20+ (22 recommended) with pnpm 10 and PostgreSQL with pgvector.

```bash
git clone https://github.com/nightzeros/chatai.git
cd chatai
cp .env.example .env
# Set BETTER_AUTH_SECRET (openssl rand -base64 32) and AI_API_KEY in .env

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), create an account, create an assistant and upload some knowledge. Migrations run automatically when the app starts.

For local development without the app container:

```bash
docker compose up -d db      # or point DATABASE_URL at Neon
pnpm install
pnpm db:migrate
pnpm dev
```

Optional demo data: `pnpm seed:demo` (signs in as `demo@chatai.local` / `DemoPass123!`).

## Embed

Copy the exact snippet from your assistant's **Install** tab. The three options are:

**Script tag** (served by your ChatAI instance, always up to date):

```html
<script
  src="https://app.nightzeros.com/widget/chat.js"
  data-assistant-id="asst_your_public_id"
  async
></script>
```

**React / Next.js**:

```bash
pnpm add @nightzeros/chatai-react
```

```tsx
"use client";

import { ChatWidget } from "@nightzeros/chatai-react";

export function SupportChat() {
  return <ChatWidget assistantId="asst_your_public_id" apiUrl="https://app.nightzeros.com" />;
}
```

**Server-side SDK** (never expose `sk_` keys in a browser):

```ts
import { ChatAI } from "@nightzeros/chatai-sdk";

const client = new ChatAI({ apiKey: process.env.CHATAI_API_KEY!, baseUrl: "https://app.nightzeros.com" });

await client.chat({
  assistantId: "asst_your_public_id",
  message: "What is your refund policy?",
  onToken: (text) => process.stdout.write(text),
});
```

Replace `https://app.nightzeros.com` with your own origin when self-hosting. The assistant ID is public, not a secret; use the domain allowlist and widget signing to control where it runs. Voice (preview) appears automatically when the assistant offers it; hide it with `data-voice="off"` or `voice={false}`.

## Packages

| Package | Description |
| --- | --- |
| [`@nightzeros/chatai-react`](https://www.npmjs.com/package/@nightzeros/chatai-react) | React / Next.js `<ChatWidget />` |
| [`@nightzeros/chatai-widget`](https://www.npmjs.com/package/@nightzeros/chatai-widget) | Framework-free `mountWidget()` API (Preact, Shadow DOM) |
| [`@nightzeros/chatai-widget-core`](https://www.npmjs.com/package/@nightzeros/chatai-widget-core) | Browser chat and Voice (preview) client used by the widget |
| [`@nightzeros/chatai-sdk`](https://www.npmjs.com/package/@nightzeros/chatai-sdk) | Node.js REST + streaming client and OpenAPI schemas |

Voice (preview) requires version 1.2.0 or later of the widget packages; ChatAI refuses Voice to older widgets.

<details>
<summary>Repository layout</summary>

```text
apps/web               Dashboard, APIs and the hosted /widget/chat.js
apps/docs              Documentation site (Fumadocs)
packages/database      Drizzle schema, migrations and DB client
packages/ai            LLM and embedding providers
packages/rag           Ingestion, retrieval, scope and answering
packages/evals         Offline and online answer-quality evaluation
packages/voice         Voice (preview) realtime provider and session runtime
packages/billing       Plans, usage metering and pricing
packages/sdk           Public npm: Node SDK + OpenAPI
packages/widget-core   Public npm: browser client
packages/widget        Public npm: mount API and chat.js bundle
packages/react         Public npm: React component
examples/              HTML, React, Next.js and Node SDK examples
```

</details>

## Self-hosting

- [Docker](https://docs.nightzeros.com/docs/self-hosting/docker): Compose stack, health checks and Voice in production.
- [Production checklist](https://docs.nightzeros.com/docs/self-hosting/production-checklist): everything to configure before going live.
- [Environment reference](https://docs.nightzeros.com/docs/self-hosting/env-reference): every setting, with defaults.
- [Upgrading to 1.1](https://docs.nightzeros.com/docs/self-hosting/upgrade-1-1) and [Backup and upgrades](https://docs.nightzeros.com/docs/self-hosting/backup-upgrade).
- [Local models (Ollama)](https://docs.nightzeros.com/docs/self-hosting/ollama).
- [Production VPS deployment](./docs/deployment/vps.md): Compose, Caddy, deploy and rollback scripts. This is how app.nightzeros.com runs; build and push your own image to adapt it.

## Documentation

The full documentation lives at **[docs.nightzeros.com](https://docs.nightzeros.com/docs)**, including:

- [Assistants](https://docs.nightzeros.com/docs/assistants), [Knowledge](https://docs.nightzeros.com/docs/knowledge) and [Providers](https://docs.nightzeros.com/docs/providers)
- [Widget](https://docs.nightzeros.com/docs/widget), [React](https://docs.nightzeros.com/docs/react) and [Voice (preview)](https://docs.nightzeros.com/docs/voice)
- [REST API](https://docs.nightzeros.com/docs/api) (OpenAPI at `GET /api/v1/openapi.json`) and [SDK](https://docs.nightzeros.com/docs/sdk)
- [Architecture](https://docs.nightzeros.com/docs/architecture)

Run the docs locally with `pnpm docs:dev` (port 3001).

## Releases

ChatAI follows [Semantic Versioning](https://semver.org/). The `/api/v1` contract and database migrations are forward compatible within a major version. See the [changelog](./CHANGELOG.md), [GitHub Releases](https://github.com/nightzeros/chatai/releases) and [versioning policy](https://docs.nightzeros.com/docs/self-hosting/versioning).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md), and see [SUPPORT.md](./SUPPORT.md) for where to ask questions.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](./SECURITY.md). Do not open public issues for security problems.

## License

[Apache License 2.0](./LICENSE).
