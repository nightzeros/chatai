# npm package audit (client libraries)

Audit for the `chore/npm-package-release` branch. Scope: prepare client libraries for public npm under `@nightzeros/chatai-*` without publishing in this PR.

## Publishable (this change)

| Package | Directory | Role |
| --- | --- | --- |
| `@nightzeros/chatai-widget-core` | `packages/widget-core` | Browser widget runtime (fetch/SSE/config) |
| `@nightzeros/chatai-widget` | `packages/widget` | Preact mount API (`mountWidget`) |
| `@nightzeros/chatai-react` | `packages/react` | React/Next `<ChatWidget />` |
| `@nightzeros/chatai-sdk` | `packages/sdk` | Node/server REST + SSE client |

## Stay private

| Package / area | Reason |
| --- | --- |
| `@chatai/web`, `@chatai/database`, `@chatai/rag`, `@chatai/ai`, `@chatai/evals` | Server/monorepo internals |
| `apps/*`, `examples/*` | Applications and demos, not libraries |

## Pre-change blockers (resolved in this branch)

- All four packages had `"private": true` and `"exports": "./src/index.ts"` (raw TypeScript, not npm-safe).
- No `dist/` library build; only `@nightzeros/chatai-widget` built IIFE `dist/chat.js` for hosted embed.
- Published deps would leak `workspace:*` without pack/publish rewriting.
- `@nightzeros/chatai-react` used a test-only path alias to `widget-types.ts` instead of `@nightzeros/chatai-widget` types.
- No npm pack/verify scripts or publish workflow.

## Preserved behavior

- Hosted zero-install embed: `https://app.nightzeros.com/widget/chat.js` (IIFE build unchanged).
- Self-host flow, widget security (`publicId`), SDK server-side `apiKey`, API contracts unchanged. Internal monorepo packages remain `@chatai/*`; public npm packages use `@nightzeros/chatai-*`.
