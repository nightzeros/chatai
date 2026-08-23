# ChatAI HTML widget examples

Minimal static pages for the hosted and self-hosted script installers.

## Prerequisites

1. Run a ChatAI app locally (default origin `http://localhost:3000`).
2. Create or seed an assistant and note its **public** assistant id (`publicId`).

## Placeholders

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `CHATAI_ORIGIN` | Absolute origin of the ChatAI deployment | `http://localhost:3000` |
| `CHATAI_ASSISTANT_ID` | Assistant `publicId` | value from seed / Install tab |

The committed fixtures use `http://localhost:3000` and `asst_replace_me`. Edit the script tags before opening the pages in a browser.

## Hosted script (`index.html`)

Matches the Dashboard → **Install** tab (hosted bundle). Serves the widget from ChatAI:

```html
<script
  src="http://localhost:3000/widget/chat.js"
  data-assistant-id="asst_replace_me"
  async
></script>
```

Replace the origin in `src` with `CHATAI_ORIGIN` and `data-assistant-id` with `CHATAI_ASSISTANT_ID`. Do **not** set `data-api-url` for the hosted case — the API origin is derived from the script URL. Open the file (or any static server) while ChatAI is running.

## Self-hosted script (`self-host.html`)

1. From the monorepo root: `pnpm examples:prepare-widget`
2. That copies `packages/widget/dist/chat.js` to `examples/html-widget/chat.js`.
3. Open `self-host.html`. The page loads `./chat.js` and sets `data-api-url="http://localhost:3000"` so API calls still hit ChatAI.

`chat.js` is generated; do not commit it.
