# Node SDK chat example

Minimal script that sends a question through [`@nightzeros/chatai-sdk`](../../packages/sdk) and prints the streamed answer.

## Prerequisites

1. Run ChatAI locally (`pnpm dev` or Docker) at `http://localhost:3000`.
2. Create an assistant and give it knowledge (or use `pnpm seed:demo`).
3. In **Account**, create an API key with the **Chat** scope. Copy the `sk_live_…` secret (shown once).
4. Note the assistant **public id** (`asst_…`) from the dashboard.

## Run

From the repo root (after `pnpm install`):

```bash
cd examples/node-sdk-chat
CHATAI_API_KEY=sk_live_... \
CHATAI_ASSISTANT_ID=asst_... \
pnpm start -- "What is your refund policy?"
```

Optional: `CHATAI_API_URL` (default `http://localhost:3000`).

OpenAPI for this instance: `GET /api/v1/openapi.json`.

Docs: [TypeScript SDK](../../apps/docs/content/docs/sdk.mdx) (site: `pnpm docs:dev` → SDK).
