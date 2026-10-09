import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import {
  assistantCreateSchema,
  assistantPatchFieldsSchema,
  assistantSchema,
  chatRequestSchema,
  documentSchema,
  errorSchema,
  feedbackRequestSchema,
  feedbackResponseSchema,
  okSchema,
  voiceSessionCreateRequestSchema,
  voiceSessionCreateResponseSchema,
  voiceSessionEndRequestSchema,
  voiceSessionEndResponseSchema,
  voiceSessionGateEventSchema,
  voiceSessionGateRequestSchema,
  voiceSessionHeartbeatRequestSchema,
  voiceSessionHeartbeatResponseSchema,
  voiceSessionRefusalSchema,
  widgetConfigSchema,
  widgetSignRequestSchema,
  widgetSignResponseSchema,
} from "./schemas";
import { API_VERSION } from "./version";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "API key",
  description: "Hashed ChatAI API key (`sk_live_…`). Create keys in Account.",
});

const json = (schema: z.ZodType, description: string) => ({
  description,
  content: {
    "application/json": { schema },
  },
});

const errorResponses = {
  401: json(errorSchema, "Missing or invalid API key"),
  403: json(errorSchema, "Missing required scope"),
  404: json(errorSchema, "Resource not found"),
  429: json(errorSchema, "Rate limit exceeded"),
};

const assistantId = z.string().openapi({
  param: { name: "assistantId", in: "path" },
  description: "Internal assistant id or public id (`asst_…`)",
});

const documentId = z.string().openapi({
  param: { name: "documentId", in: "path" },
});

const conversationId = z.string().openapi({
  param: { name: "conversationId", in: "path" },
});

const publicId = z.string().openapi({
  param: { name: "publicId", in: "path" },
  description: "Assistant public id (`asst_…`)",
});

const bearer = [{ bearerAuth: [] }];

registry.registerPath({
  method: "post",
  path: "/api/v1/chat",
  summary: "Stream a chat reply",
  description:
    "SSE stream of token/meta/done events. Widget clients may omit Authorization and pass the assistant public id. API keys require the `chat` scope and must own the assistant.",
  tags: ["Chat"],
  security: [{ bearerAuth: [] }, {}],
  request: {
    body: {
      content: { "application/json": { schema: chatRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Server-sent events (`token`, `meta`, `done`)",
      content: {
        "text/event-stream": { schema: z.string() },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants",
  summary: "List assistants",
  tags: ["Assistants"],
  security: bearer,
  responses: {
    200: json(z.object({ assistants: z.array(assistantSchema) }), "Assistants owned by the key"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assistants",
  summary: "Create an assistant",
  tags: ["Assistants"],
  security: bearer,
  request: {
    body: { content: { "application/json": { schema: assistantCreateSchema } } },
  },
  responses: {
    201: json(z.object({ assistant: assistantSchema }), "Created assistant"),
    400: json(errorSchema, "Invalid body"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{assistantId}",
  summary: "Get an assistant",
  tags: ["Assistants"],
  security: bearer,
  request: { params: z.object({ assistantId }) },
  responses: {
    200: json(z.object({ assistant: assistantSchema }), "Assistant"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/api/v1/assistants/{assistantId}",
  summary: "Update an assistant",
  tags: ["Assistants"],
  security: bearer,
  request: {
    params: z.object({ assistantId }),
    body: { content: { "application/json": { schema: assistantPatchFieldsSchema } } },
  },
  responses: {
    200: json(z.object({ assistant: assistantSchema }), "Updated assistant"),
    400: json(errorSchema, "Invalid body"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/assistants/{assistantId}",
  summary: "Delete an assistant",
  tags: ["Assistants"],
  security: bearer,
  request: { params: z.object({ assistantId }) },
  responses: {
    200: json(okSchema, "Deleted"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{assistantId}/documents",
  summary: "List documents",
  tags: ["Documents"],
  security: bearer,
  request: { params: z.object({ assistantId }) },
  responses: {
    200: json(z.object({ documents: z.array(documentSchema) }), "Documents"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{assistantId}/documents/{documentId}",
  summary: "Get a document",
  tags: ["Documents"],
  security: bearer,
  request: { params: z.object({ assistantId, documentId }) },
  responses: {
    200: json(z.object({ document: documentSchema }), "Document"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "delete",
  path: "/api/v1/assistants/{assistantId}/documents/{documentId}",
  summary: "Delete a document",
  tags: ["Documents"],
  security: bearer,
  request: { params: z.object({ assistantId, documentId }) },
  responses: {
    200: json(okSchema, "Deleted"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/assistants/{assistantId}/documents/{documentId}/reprocess",
  summary: "Reprocess a document",
  tags: ["Documents"],
  security: bearer,
  request: { params: z.object({ assistantId, documentId }) },
  responses: {
    200: json(okSchema, "Queued"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{assistantId}/conversations",
  summary: "List conversations",
  tags: ["Conversations"],
  security: bearer,
  request: { params: z.object({ assistantId }) },
  responses: {
    200: json(z.object({ conversations: z.array(z.record(z.unknown())) }), "Conversations"),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{assistantId}/conversations/{conversationId}",
  summary: "Get a conversation transcript",
  tags: ["Conversations"],
  security: bearer,
  request: { params: z.object({ assistantId, conversationId }) },
  responses: {
    200: json(
      z.object({
        conversation: z.record(z.unknown()),
        messages: z.array(z.record(z.unknown())),
      }),
      "Transcript",
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{assistantId}/analytics",
  summary: "Analytics summary",
  tags: ["Analytics"],
  security: bearer,
  request: { params: z.object({ assistantId }) },
  responses: {
    200: json(
      z.object({
        metrics: z.record(z.unknown()),
        topUnanswered: z.array(z.record(z.unknown())),
      }),
      "Summary metrics",
    ),
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/assistants/{publicId}/config",
  summary: "Public widget configuration",
  description:
    "Keyless embed endpoint. Returns display settings only (no secrets). Domain allowlist and rate limits apply.",
  tags: ["Widget"],
  security: [],
  request: { params: z.object({ publicId }) },
  responses: {
    200: json(widgetConfigSchema, "Widget-safe assistant config"),
    404: json(errorSchema, "Assistant not found"),
    403: json(errorSchema, "Origin not allowed or policy violation"),
    429: json(errorSchema, "Rate limit exceeded"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/feedback",
  summary: "Rate an assistant message",
  description: "Widget visitors submit thumbs up/down for a message they received.",
  tags: ["Widget"],
  security: [],
  request: {
    body: { content: { "application/json": { schema: feedbackRequestSchema } } },
  },
  responses: {
    200: json(feedbackResponseSchema, "Feedback recorded"),
    400: json(errorSchema, "Invalid body"),
    403: json(errorSchema, "Not authorized to rate this message"),
    404: json(errorSchema, "Message not found"),
    429: json(errorSchema, "Rate limit exceeded"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/widget/sign",
  summary: "Issue a widget HMAC signature",
  description:
    "When `requireWidgetSigning` is enabled, the embed must call this before chat/feedback. Domain allowlist and rate limits apply.",
  tags: ["Widget"],
  security: [],
  request: {
    body: { content: { "application/json": { schema: widgetSignRequestSchema } } },
  },
  responses: {
    200: json(widgetSignResponseSchema, "Short-lived signature"),
    400: json(errorSchema, "Invalid body or signing not configured"),
    404: json(errorSchema, "Assistant not found"),
    403: json(errorSchema, "Origin not allowed or policy violation"),
    429: json(errorSchema, "Rate limit exceeded"),
  },
});

const voiceSessionId = z.string().openapi({
  param: { name: "sessionId", in: "path" },
  description: "ChatAI voice session id returned from mint",
});

registry.registerPath({
  method: "post",
  path: "/api/v1/voice/sessions",
  summary: "Mint a realtime voice session (WebRTC SDP exchange)",
  description:
    "Server exchanges the browser SDP offer with the configured realtime provider (GPT-Live). Permanent provider credentials never leave the server. Widget clients are gated by the same SecurityPolicy as chat (domain allowlist, rate limits, bot heuristics, optional HMAC). API keys require the dedicated `voice` scope (not implied by `chat`). When conversation storage is enabled, `conversationId` identifies the durable conversation that voice turns are written to (continue it via text chat); it is null for ephemeral (no-store) sessions. `transcriptSaved` is false when Voice turns are not saved as text (no-store, or Voice transcripts off); such turns are used only during the live session. Client `history` is used only for ephemeral sessions; stored conversations use stored turns. `recording` is true when session audio is recorded for owner-only playback; this happens only with conversation storage on, the assistant's audio recording setting on and object storage configured, and requires `recordingConsent: true` (always for widget/playground; for API keys when the assistant requires consent); a missing required consent is rejected with 400. Voice usage is admitted before any provider session is created: when the account's Voice minutes for the period are used up the mint is refused with 402 (`reason: voice_minutes_exhausted`), and when too many Voice sessions are active it is refused with 429 (`reason: voice_concurrency_limit`). Widget callers instead receive one neutral refusal for both cases, 403 with `reason: voice_unavailable`, which never reveals plan, usage or quota details. A new widget mint for the same visitor ends that visitor's previous session. The browser data channel cannot send control events to the provider session; if the provider does not confirm that restriction the mint fails with 502 `reason: voice_unavailable`. Clients must declare `capabilities: [\"playback_gate\"]`: ChatAI's backend, not the Voice model, decides which assistant speech the visitor may hear, and the client must keep assistant audio and captions muted unless the gate stream (`/gate`) approves them. A mint without it is refused with 403 `reason: voice_unavailable`. Gated sessions receive a session-scoped `controlToken` and `playbackGate: true`. Clients that also declare `heartbeat` receive `heartbeatIntervalMs` for the heartbeat endpoint; ChatAI ends such a session when heartbeats stop for 45 seconds. Clients that never declare heartbeats are never ended for missing ones.",
  tags: ["Voice"],
  security: [{ bearerAuth: [] }, {}],
  request: {
    body: {
      content: { "application/json": { schema: voiceSessionCreateRequestSchema } },
    },
  },
  responses: {
    ...errorResponses,
    200: json(voiceSessionCreateResponseSchema, "SDP answer + ChatAI session id"),
    400: json(errorSchema, "Invalid body or missing consent"),
    403: json(
      voiceSessionRefusalSchema,
      "Voice disabled, policy violation, missing `playback_gate` capability, or neutral widget refusal (`reason: voice_unavailable`)",
    ),
    402: json(voiceSessionRefusalSchema, "Voice minutes for the period are used up"),
    404: json(errorSchema, "Assistant not found"),
    429: json(
      voiceSessionRefusalSchema,
      "Rate limit exceeded, or too many concurrent Voice sessions (`reason: voice_concurrency_limit`)",
    ),
    502: json(
      voiceSessionRefusalSchema,
      "Provider SDP or sideband failure (widget callers and browser-command-lock failures get `reason: voice_unavailable`)",
    ),
    503: json(errorSchema, "Voice provider not configured"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/voice/sessions/{sessionId}/heartbeat",
  summary: "Voice control heartbeat",
  description:
    "Liveness for a live Voice call, authorized only by the `controlToken` returned from mint (no API key or widget signature). Returns `healthy`, `degraded` (ChatAI is reconnecting its provider control link; heartbeat every `nextHeartbeatMs`, which is shorter while degraded), `ended` (with the public `endReason` when known), or `lost` (the server that ran the call is gone; ChatAI is ending it). At most one heartbeat per second per session is accepted. 421 means the request reached a different server than the one running the call (single replica or sticky routing required).",
  tags: ["Voice"],
  security: [{}],
  request: {
    params: z.object({ sessionId: voiceSessionId }),
    body: {
      content: { "application/json": { schema: voiceSessionHeartbeatRequestSchema } },
    },
  },
  responses: {
    200: json(voiceSessionHeartbeatResponseSchema, "Control-plane state"),
    404: json(errorSchema, "Unknown session or invalid token"),
    421: json(errorSchema, "Misrouted: the call runs on another server"),
    429: json(errorSchema, "More than one heartbeat per second"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/voice/sessions/{sessionId}/gate",
  summary: "Voice playback gate stream",
  description:
    "Server-authoritative playback decisions for a live Voice call, authorized only by the mint's `controlToken`. The response is NDJSON (`application/x-ndjson`), one event per line: the current decision first, then each new decision (`{\"type\":\"gate\",\"seq\",\"state\":\"open\"|\"closed\",\"reason\",\"inputEndMs\"}`), `{\"type\":\"keepalive\"}` every 10 seconds, and `{\"type\":\"end\"}` when the call ends. The client plays assistant audio and shows assistant captions only while the latest decision is `open`, closes locally as soon as visitor speech starts after the open decision's `inputEndMs`, and stays muted while the stream is down (reconnect with backoff). Decisions carry no conversation content. 421 means the request reached a different server than the one running the call.",
  tags: ["Voice"],
  security: [{}],
  request: {
    params: z.object({ sessionId: voiceSessionId }),
    body: {
      content: { "application/json": { schema: voiceSessionGateRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "NDJSON stream of gate events",
      content: { "application/x-ndjson": { schema: voiceSessionGateEventSchema } },
    },
    404: json(errorSchema, "Unknown or ended session, or invalid token"),
    421: json(errorSchema, "Misrouted: the call runs on another server"),
    429: json(errorSchema, "Too many concurrent gate streams for the session"),
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/voice/sessions/{sessionId}/end",
  summary: "End a realtime voice session",
  description:
    "Ends the provider session server-side (provider hangup), waits a bounded time for finalized usage on the server sideband when possible, and discards ephemeral conversational buffers. Incomplete usage finalization is reported explicitly. `endReason` is set when ChatAI ended the session itself (`usage_limit`: Voice minutes used up, reported to widget callers as the neutral `voice_unavailable`; `superseded`: a newer session for the same visitor; `idle`: no visitor speech for the idle timeout; `max_duration`: the 60-minute cap; `heartbeat_lost` / `control_lost`: the client or ChatAI's provider control link was lost, both reported to widget callers as `disconnected`; `shutdown`: the ChatAI server shut down or restarted gracefully, reported to widget callers as `disconnected`); for a few minutes after such an end, calling this endpoint returns that result instead of 404.",
  tags: ["Voice"],
  security: [{ bearerAuth: [] }, {}],
  request: {
    params: z.object({ sessionId: voiceSessionId }),
    body: {
      content: { "application/json": { schema: voiceSessionEndRequestSchema } },
    },
  },
  responses: {
    ...errorResponses,
    200: json(voiceSessionEndResponseSchema, "Session ended / usage summary"),
    403: json(errorSchema, "Policy violation or visitor mismatch"),
    404: json(errorSchema, "Session not found"),
  },
});

export function getOpenApiDocument(): {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths?: Record<string, unknown>;
  components?: { securitySchemes?: Record<string, unknown> };
} {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ChatAI API",
      version: API_VERSION,
      description:
        "Stable v1 REST API. Owner routes require Bearer `sk_` keys. Widget routes are keyless with domain allowlist + rate limits. Document upload stays dashboard-only. Voice mint/end is additive under `/api/v1/voice/*`.",
    },
    servers: [{ url: "/", description: "ChatAI instance origin" }],
    tags: [
      { name: "Chat" },
      { name: "Assistants" },
      { name: "Documents" },
      { name: "Conversations" },
      { name: "Analytics" },
      { name: "Widget" },
      { name: "Voice" },
    ],
  });
}
