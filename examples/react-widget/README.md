# ChatAI React widget example

Minimal Vite + React app that mounts the private `@chatai/react` package via
`workspace:*`. Do not publish this example or expect `pnpm add @chatai/react`
from npm until packages are published.

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

## Run

```bash
cp examples/react-widget/.env.example examples/react-widget/.env
# set VITE_CHATAI_ASSISTANT_ID (publicId from Dashboard → Install)

pnpm --filter @chatai/example-react-widget dev
```

Open the printed local URL. The launcher mounts via:

```tsx
<ChatWidget
  assistantId={import.meta.env.VITE_CHATAI_ASSISTANT_ID}
  apiUrl={import.meta.env.VITE_CHATAI_ORIGIN || "http://localhost:3000"}
/>
```

`apiUrl` must be the absolute ChatAI origin (same as `BETTER_AUTH_URL` / widget API host).

If `.env` is missing, the page now shows setup instructions instead of a blank widget. Vite only reads `.env` on startup, so restart the example after creating that file.
