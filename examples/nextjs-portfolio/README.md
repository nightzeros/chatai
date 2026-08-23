# ChatAI Next.js portfolio example

Minimal App Router site with a portfolio layout and the private `@chatai/react`
`<ChatWidget />` embed. Not published — use `workspace:*` inside this monorepo.

## Prerequisites

1. From the monorepo root: `pnpm install`
2. Run ChatAI locally (default `http://localhost:3000`)
3. Have an assistant `publicId` (Dashboard → Install, or `pnpm seed:demo`)

## Environment

```bash
cp examples/nextjs-portfolio/.env.example examples/nextjs-portfolio/.env.local
```

| Variable | Meaning |
| --- | --- |
| `NEXT_PUBLIC_CHATAI_API_URL` | Absolute ChatAI origin (`apiUrl`) |
| `NEXT_PUBLIC_CHATAI_ASSISTANT_ID` | Assistant `publicId` |

Client components need the `NEXT_PUBLIC_` prefix. Values match the plan’s
`CHATAI_API_URL` / `CHATAI_ASSISTANT_ID` conceptually.

## Run

```bash
pnpm --filter @chatai/example-nextjs-portfolio dev
```

Open [http://localhost:3002](http://localhost:3002). The floating chat launcher
loads from `@chatai/react` against your ChatAI instance.

## Notes

- `@chatai/react` is not on npm yet — only `workspace:*` in this repo
- Point `NEXT_PUBLIC_CHATAI_API_URL` at the same origin as `BETTER_AUTH_URL` on the ChatAI app
- For a seeded support bot: `pnpm seed:demo`, wait for ingestion, paste the Support Bot `publicId`
