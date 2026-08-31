# ChatAI React widget example

Minimal Vite + React app that mounts `@chatai/react`.

## Prerequisites

1. From the monorepo root: `pnpm install`
2. Run ChatAI locally (default `http://localhost:3000`)
3. Have an assistant `publicId`

## Environment

Create `examples/react-widget/.env` (not committed):

```env
VITE_CHATAI_ORIGIN=http://localhost:3000
VITE_CHATAI_ASSISTANT_ID=asst_replace_me
```

| Variable | Meaning |
| --- | --- |
| `VITE_CHATAI_ORIGIN` | Absolute ChatAI origin passed as `apiUrl` |
| `VITE_CHATAI_ASSISTANT_ID` | Assistant `publicId` |

## Run (monorepo)

```bash
cp examples/react-widget/.env.example examples/react-widget/.env
# set VITE_CHATAI_ASSISTANT_ID (publicId from Dashboard → Install)

pnpm --filter @chatai/example-react-widget dev
```

## Test with packed tarballs (CI-style)

After `pnpm packages:verify` from the repo root:

```bash
npm install /tmp/chatai-npm-pack/chatai-widget-core-*.tgz \
  /tmp/chatai-npm-pack/chatai-widget-*.tgz \
  /tmp/chatai-npm-pack/chatai-react-*.tgz
```

Then point the example at those installs instead of `workspace:*`.

Open the printed local URL. The launcher mounts via:

```tsx
<ChatWidget
  assistantId={import.meta.env.VITE_CHATAI_ASSISTANT_ID}
  apiUrl={import.meta.env.VITE_CHATAI_ORIGIN || "http://localhost:3000"}
/>
```

`apiUrl` must be the absolute ChatAI origin (same as `BETTER_AUTH_URL` / widget API host).

If `.env` is missing, the page now shows setup instructions instead of a blank widget. Vite only reads `.env` on startup, so restart the example after creating that file.
