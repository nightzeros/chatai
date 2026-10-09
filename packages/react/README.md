# @nightzeros/chatai-react

React and Next.js component for the [ChatAI](https://github.com/nightzeros/chatai) chat widget. It mounts the same Shadow DOM widget as the hosted `chat.js` script, so your page styles and the widget never collide.

## Install

```bash
npm install @nightzeros/chatai-react
# or: pnpm add @nightzeros/chatai-react
```

React 18 or 19 (`react` and `react-dom`) are peer dependencies.

## Usage

```tsx
"use client";

import { ChatWidget } from "@nightzeros/chatai-react";

export function SupportChat() {
  return <ChatWidget assistantId="asst_your_public_id" apiUrl="https://app.nightzeros.com" />;
}
```

- `assistantId` is the assistant's public ID (`asst_…`) from the **Install** tab. It is public, not a secret.
- `apiUrl` is the absolute origin of your ChatAI instance (`https://app.nightzeros.com` for the hosted service).
- The component renders on the client only; in the Next.js App Router, use it from a client component as shown.

## Props

| Prop                  | Type                              | Notes                                                                 |
| --------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `assistantId`         | `string`                          | Required                                                              |
| `apiUrl`              | `string`                          | Required, absolute URL                                                |
| `theme`               | `"light" \| "dark" \| "system"`   | Overrides the saved setting                                           |
| `position`            | `"bottom-left" \| "bottom-right"` | Overrides the saved setting                                           |
| `primaryColor`        | `string`                          | 6-digit hex                                                           |
| `iconUrl`             | `string \| null`                  | Launcher icon                                                         |
| `suggestedQuestions`  | `string[]`                        | Starter prompts                                                       |
| `showSources`         | `boolean`                         | Show citation chips                                                   |
| `layout`              | `"fixed" \| "contained"`          | `contained` renders inside the wrapper instead of floating            |
| `voice`               | `boolean`                         | Set `false` to hide Voice (preview) even when the assistant offers it |
| `signEndpoint`        | `string`                          | Your signing endpoint when the assistant requires signed widgets      |
| `className`           | `string`                          | Wrapper class                                                         |
| `onReady` / `onError` | callbacks                         | Called after mount or on mount failure                                |

Settings you leave out come from the assistant's saved **Customize** settings.

Low-level API: `mountChatWidget(element, options)` mounts the widget into any element and returns `{ destroy() }`.

## Voice (preview)

When the assistant owner turns on Voice and the ChatAI instance has a Voice provider configured, the widget shows a microphone button. Voice needs HTTPS (or `localhost`), microphone permission and WebRTC; otherwise the widget explains why and text chat keeps working. Voice is a preview feature and may change in minor releases. It requires version 1.2.0 or later of this package; older versions get "Voice isn't available right now" from ChatAI 1.2.0 and later.

## Compatibility

- Version 1.x works with ChatAI servers exposing `/api/v1`.
- Browsers: current Chrome, Edge, Firefox and Safari (Shadow DOM, `fetch` streaming).

## Links

- Documentation: [docs.nightzeros.com/docs/react](https://docs.nightzeros.com/docs/react)
- Voice (preview): [docs.nightzeros.com/docs/voice](https://docs.nightzeros.com/docs/voice)
- Repository: [github.com/nightzeros/chatai](https://github.com/nightzeros/chatai)
- Changelog: [CHANGELOG.md](https://github.com/nightzeros/chatai/blob/main/CHANGELOG.md)

## License

[Apache-2.0](./LICENSE)
