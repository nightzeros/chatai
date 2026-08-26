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
        "Stable v1 REST API. Owner routes require Bearer `sk_` keys. Widget routes are keyless with domain allowlist + rate limits. Document upload stays dashboard-only.",
    },
    servers: [{ url: "/", description: "ChatAI instance origin" }],
    tags: [
      { name: "Chat" },
      { name: "Assistants" },
      { name: "Documents" },
      { name: "Conversations" },
      { name: "Analytics" },
      { name: "Widget" },
    ],
  });
}
