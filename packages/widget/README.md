# @nightzeros/chatai-widget

Framework-free mount API for the [ChatAI](https://github.com/nightzeros/chatai) chat widget. Renders the widget with Preact inside a Shadow DOM, so host-page CSS cannot leak in or out. Use it in any frontend stack; for React and Next.js, prefer [`@nightzeros/chatai-react`](https://www.npmjs.com/package/@nightzeros/chatai-react).

If you only need a script tag, you do not need this package: load `https://<your-chatai-origin>/widget/chat.js` instead (see [Widget docs](https://docs.nightzeros.com/docs/widget)).

## Install

```bash
npm install @nightzeros/chatai-widget
# or: pnpm add @nightzeros/chatai-widget
```

## Usage

```ts
import { mountWidget } from "@nightzeros/chatai-widget";

const instance = mountWidget(document.getElementById("chat")!, {
  assistantId: "asst_your_public_id",
  apiUrl: "https://app.nightzeros.com",
});

// Later, to remove the widget and release the microphone:
instance.destroy();
```

## Options

| Option                         | Type                              | Notes                                                                             |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------- |
| `assistantId`                  | `string`                          | Required; the assistant's public ID                                               |
| `apiUrl`                       | `string`                          | Required; absolute origin of your ChatAI instance                                 |
| `theme`                        | `"light" \| "dark" \| "system"`   | Overrides the saved setting                                                       |
| `position`                     | `"bottom-left" \| "bottom-right"` | Overrides the saved setting                                                       |
| `primaryColor`                 | `string`                          | 6-digit hex                                                                       |
| `iconUrl`                      | `string \| null`                  | Launcher icon                                                                     |
| `suggestedQuestions`           | `string[]`                        | Starter prompts                                                                   |
| `showSources`                  | `boolean`                         | Show citation chips                                                               |
| `layout`                       | `"fixed" \| "contained"`          | `contained` renders inside the target element                                     |
| `voice`                        | `boolean`                         | Set `false` to hide Voice (preview)                                               |
| `signEndpoint`                 | `string`                          | Signing endpoint for assistants that require signed widgets                       |
| `fetch`, `storage`, `createId` | advanced                          | Inject `fetch`, a `localStorage`-like store, or an ID generator (useful in tests) |

`optionsFromScript(scriptElement)` reads the same options from `data-*` attributes (`data-assistant-id`, `data-api-url`, `data-theme`, `data-position`, `data-sign-endpoint`, `data-voice="off"`).

## Voice (preview)

When the assistant offers Voice and the server has a Voice provider configured, the widget adds a microphone button with a live transcript and, when recording is enabled, a consent prompt before the microphone turns on. Voice needs HTTPS (or `localhost`), microphone permission and WebRTC. It is a preview feature and requires version 1.1.0 or later.

## Compatibility

- Version 1.x works with ChatAI servers exposing `/api/v1`.
- Browsers: current Chrome, Edge, Firefox and Safari.

## Links

- Documentation: [docs.nightzeros.com/docs/widget](https://docs.nightzeros.com/docs/widget)
- Repository: [github.com/nightzeros/chatai](https://github.com/nightzeros/chatai)
- Changelog: [CHANGELOG.md](https://github.com/nightzeros/chatai/blob/main/CHANGELOG.md)

## License

[Apache-2.0](./LICENSE)
