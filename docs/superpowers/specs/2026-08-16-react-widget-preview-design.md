# React Widget Wrapper and Draft Preview Design

## Goal

Provide a private `@chatai/react` package that mounts the existing Shadow DOM
widget, then replace the Customize mock with an isolated preview that reflects
unsaved form values without publishing them.

## Architecture

`@chatai/react` owns React lifecycle integration only. `mountChatWidget` calls
`mountWidget` from `@chatai/widget`, and `ChatWidget` uses an effect to mount
once, remount when a supported option changes, and destroy the instance on
unmount. It does not implement rendering, HTTP requests, SSE parsing, or chat
state.

The widget mount API accepts display-setting overrides and an optional
contained layout mode. Production embeds retain the default fixed viewport
layout. The dashboard preview uses contained layout and draft overrides while
still loading the public assistant configuration for its name and welcome
message.

## Public Interfaces

`@chatai/react` exports:

- `mountChatWidget(element, options): WidgetInstance`
- `ChatWidget(props): React.ReactElement | null`

`ChatWidget` accepts the widget controller options, supported visual settings,
`className`, `onReady`, and `onError`. It returns `null` during server-side
rendering and mounts only after the browser effect runs.

The widget mount API exposes a `WidgetMountOptions` type. It includes
assistant/API options, all supported visual overrides (`primaryColor`,
`position`, `theme`, `iconUrl`, `suggestedQuestions`, `showSources`), optional
`layout: "fixed" | "contained"`, and the existing storage/fetch ID injection
points.

## Draft Preview

The Customize form keeps every setting in React state. Changes update a
`WidgetPreview` component immediately; Save only submits the same draft values
to the existing server action. The preview mounts the real widget with:

- `assistant.publicId` and the configured absolute ChatAI origin;
- the unsaved display-setting overrides;
- `layout: "contained"` so it stays within the preview frame;
- an inert storage implementation so no preview chat state reaches
  `localStorage` or a deployed widget.

The preview is visibly labeled "Draft preview — not published" so it does not
imply the public embed has changed. The user can experiment, open the widget,
and inspect visual controls before saving.

## Error Handling

The wrapper reports mount-time errors through `onError` when supplied. Fetch
and streaming errors continue to render through the existing widget UI. The
preview fails within its own container and does not modify public settings.

## Testing

- Widget tests prove visual overrides win over public config and contained
  layout avoids fixed viewport positioning.
- React/jsdom tests prove one mount per option set, remount for supported
  option changes, destruction during unmount, and null server rendering.
- Dashboard tests cover draft settings passed to the preview as an isolated
  mount configuration.

## Constraints

- React remains a peer dependency compatible with React 18 and 19.
- Preact remains internal to `@chatai/widget`.
- Packages remain private and source-exported workspace packages.
- No new public API endpoints, schema changes, or duplicate chat behavior.
- Saving is the only action that publishes assistant settings.
