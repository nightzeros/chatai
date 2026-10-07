# @nightzeros/chatai-widget-core

Browser client for [ChatAI](https://github.com/nightzeros/chatai) assistants: loads the public widget config, streams chat replies, sends feedback, and runs Voice (preview) sessions. It has no UI and no dependencies.

Most sites should use [`@nightzeros/chatai-react`](https://www.npmjs.com/package/@nightzeros/chatai-react), [`@nightzeros/chatai-widget`](https://www.npmjs.com/package/@nightzeros/chatai-widget) or the hosted `chat.js` script. Use this package to build your own chat interface.

## Install

```bash
npm install @nightzeros/chatai-widget-core
# or: pnpm add @nightzeros/chatai-widget-core
```

## Usage

```ts
import { createWidgetController } from "@nightzeros/chatai-widget-core";

const chat = createWidgetController({
  assistantId: "asst_your_public_id",
  apiUrl: "https://app.nightzeros.com",
});

const unsubscribe = chat.subscribe((state) => {
  console.log(state.status, state.messages);
});

await chat.load();
await chat.send("What are your opening hours?");

// When finished:
unsubscribe();
chat.destroy();
```

## Controller

`createWidgetController(options)` accepts `assistantId`, `apiUrl`, and optional `fetch`, `storage`, `createId` and `signEndpoint` (for assistants that require signed widgets). It returns:

| Method                                                   | Purpose                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `load()`                                                 | Fetch the assistant's public config                            |
| `send(message)`                                          | Send a message and stream the reply into state                 |
| `sendFeedback(messageId, rating)`                        | Rate a reply `"positive"` or `"negative"`                      |
| `getState()` / `subscribe(listener)`                     | Read state or listen for changes                               |
| `voiceAvailable()` / `voiceSupported()`                  | Whether the assistant offers Voice and the browser supports it |
| `voiceConsentRequired()`                                 | Whether a recording notice must be accepted first              |
| `startVoice()` / `endVoice()`                            | Start or end a Voice (preview) session                         |
| `acceptRecordingConsent()` / `declineRecordingConsent()` | Answer the recording notice                                    |
| `voiceLevels()` / `dismissVoiceError()`                  | Audio levels for a visualizer; clear a Voice error             |
| `destroy()`                                              | Stop streams and Voice and release the microphone              |

Other exports include `resolveApiUrl`, `createSseParser`, `clientHistory`, Voice helpers (`createVoiceSession`, `deriveVoicePhase`, `isVoiceActive`, `VOICE_PHASE_LABELS`, `VOICE_ERROR_MESSAGES`, `VOICE_END_NOTICES`), control-health helpers, and TypeScript types such as `WidgetState`, `WidgetMessage` and `WidgetConfig`.

## Voice (preview)

Voice APIs were added in 1.1.0 and are a preview: their shape may change in minor releases. Voice needs HTTPS (or `localhost`), microphone permission and WebRTC, and a ChatAI server with a Voice provider configured.

## Compatibility

- Version 1.x works with ChatAI servers exposing `/api/v1`.
- Runs in modern browsers (`fetch` streaming, `ReadableStream`). ES module only.

## Links

- Documentation: [docs.nightzeros.com](https://docs.nightzeros.com/docs)
- Repository: [github.com/nightzeros/chatai](https://github.com/nightzeros/chatai)
- Changelog: [CHANGELOG.md](https://github.com/nightzeros/chatai/blob/main/CHANGELOG.md)

## License

[Apache-2.0](./LICENSE)
