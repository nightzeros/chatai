# @nightzeros/chatai-sdk

TypeScript client for the [ChatAI](https://github.com/nightzeros/chatai) REST API: streaming chat plus owner routes for assistants, documents, conversations and analytics. Also ships the Zod schemas and OpenAPI document for `/api/v1`.

**Server-side only.** The SDK authenticates with an `sk_live_…` API key; never ship that key to a browser. For browser chat, use the widget packages.

## Install

```bash
npm install @nightzeros/chatai-sdk
# or: pnpm add @nightzeros/chatai-sdk
```

Requires Node.js 20 or later (ES module).

## Usage

```ts
import { ChatAI } from "@nightzeros/chatai-sdk";

const client = new ChatAI({
  apiKey: process.env.CHATAI_API_KEY!,
  baseUrl: process.env.CHATAI_API_URL ?? "https://app.nightzeros.com",
});

const result = await client.chat({
  assistantId: "asst_your_public_id",
  message: "What is your refund policy?",
  onToken: (text) => process.stdout.write(text),
});

console.log(result.conversationId, result.sources);
```

Create API keys on the dashboard **Account** page; the secret is shown once. Each key has scopes; `chat` is required for `client.chat()`.

## Methods

| Method                                                                                     | Scope                |
| ------------------------------------------------------------------------------------------ | -------------------- |
| `chat({ assistantId, message, conversationId?, visitorId?, history?, signal?, onToken? })` | `chat`               |
| `listAssistants()`, `getAssistant(id)`                                                     | `assistants:read`    |
| `createAssistant(body)`, `updateAssistant(id, body)`, `deleteAssistant(id)`                | `assistants:write`   |
| `listDocuments(id)`, `getDocument(id, documentId)`                                         | `documents:read`     |
| `deleteDocument(id, documentId)`, `reprocessDocument(id, documentId)`                      | `documents:write`    |
| `listConversations(id)`, `getConversation(id, conversationId)`                             | `conversations:read` |
| `getAnalytics(id)`                                                                         | `analytics:read`     |

Failed requests throw `ChatAIError` with `status` and, for `429`, `retryAfter` in seconds.

## Schemas and OpenAPI

```ts
import { chatRequestSchema, getOpenApiDocument, API_VERSION } from "@nightzeros/chatai-sdk";
```

Exports include the request schemas (`chatRequestSchema`, `assistantCreateSchema`, `assistantPatchSchema`), Voice (preview) session schemas added in 1.1.0 (`voiceSessionCreateRequestSchema` and related), `getOpenApiDocument()` and `API_VERSION`. A running server also serves the document at `GET /api/v1/openapi.json`.

## Compatibility

- Version 1.x targets the stable `/api/v1` API; changes within 1.x are additive.
- Voice (preview) schemas may change in minor releases.

## Links

- Documentation: [docs.nightzeros.com/docs/sdk](https://docs.nightzeros.com/docs/sdk)
- REST API: [docs.nightzeros.com/docs/api](https://docs.nightzeros.com/docs/api)
- Repository: [github.com/nightzeros/chatai](https://github.com/nightzeros/chatai)
- Changelog: [CHANGELOG.md](https://github.com/nightzeros/chatai/blob/main/CHANGELOG.md)

## License

[Apache-2.0](./LICENSE)
