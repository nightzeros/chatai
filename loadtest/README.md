# Load testing

Scripts use Node’s built-in `fetch` (no k6 dependency) so CI and contributors can run smoke load without extra installs.

## Targets

| Script | Endpoint | Default |
| --- | --- | --- |
| `config.mjs` | `GET /api/v1/assistants/{id}/config` | Concurrent GETs |
| `chat.mjs` | `POST /api/v1/chat` | Concurrent short chats (SSE) |
| `smoke.mjs` | health + config | One-shot readiness |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://127.0.0.1:3000` | Instance origin |
| `ASSISTANT_ID` | (required for config/chat) | Public `asst_…` id |
| `CONCURRENCY` | `10` | Parallel workers |
| `REQUESTS` | `50` | Total requests |
| `CHAT_MESSAGE` | `What is the refund period?` | Chat body |

## Smoke SLOs (local guidance)

These are soft targets for a single-node Docker install on a laptop, not production SLAs:

| Check | Target |
| --- | --- |
| `GET /api/health` | p95 &lt; 200 ms |
| `GET …/config` | p95 &lt; 500 ms, error rate &lt; 1% |
| `POST /api/v1/chat` (first token) | p95 &lt; 5 s with a warm model (provider-dependent) |

Run:

```bash
pnpm loadtest:smoke
BASE_URL=http://127.0.0.1:3000 ASSISTANT_ID=asst_… pnpm loadtest:config
BASE_URL=http://127.0.0.1:3000 ASSISTANT_ID=asst_… pnpm loadtest:chat
```
