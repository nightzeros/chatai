import { z } from "zod";

export const hallucinationModeSchema = z.enum(["strict", "balanced", "flexible"]);

export const assistantCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(8000).nullable().optional(),
  hallucinationMode: hallucinationModeSchema.optional(),
});

export const assistantPatchFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  welcomeMessage: z.string().trim().min(1).max(500).optional(),
  instructions: z.string().trim().max(8000).nullable().optional(),
  hallucinationMode: hallucinationModeSchema.optional(),
});

export const assistantPatchSchema = assistantPatchFieldsSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: "No fields to update." },
);

/**
 * Recent turns held by the client. Used only when the server keeps no stored
 * history for the conversation (e.g. conversation storage is off).
 */
export const conversationHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(4000),
    }),
  )
  .max(40);

export const chatRequestSchema = z.object({
  assistantId: z.string().min(1, "assistantId is required"),
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1, "message is required").max(4000),
  visitorId: z.string().min(1).max(80).optional(),
  source: z.enum(["playground", "widget", "api"]).optional(),
  history: conversationHistorySchema.optional(),
  /** Voice became unavailable earlier in this conversation; carries no reason. */
  voiceUnavailable: z.boolean().optional(),
});

export const errorSchema = z.object({
  error: z.string(),
});

export const assistantSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  welcomeMessage: z.string(),
  instructions: z.string().nullable(),
  hallucinationMode: hallucinationModeSchema,
  settings: z.record(z.unknown()),
  ragSettings: z.record(z.unknown()),
  modelSettings: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const documentSchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  type: z.enum(["file", "text", "faq", "url"]),
  name: z.string(),
  mimeType: z.string().nullable(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  error: z.string().nullable(),
  chunkCount: z.number(),
  excluded: z.boolean(),
  url: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const okSchema = z.object({ ok: z.literal(true) });

export const widgetConfigSchema = z.object({
  assistantId: z.string(),
  name: z.string(),
  welcomeMessage: z.string(),
  settings: z.record(z.unknown()),
  requireWidgetSigning: z.boolean().optional(),
});

export const feedbackRequestSchema = z.object({
  messageId: z.string().min(1),
  rating: z.enum(["positive", "negative"]),
  visitorId: z.string().min(1).max(80).optional(),
});

export const feedbackResponseSchema = z.object({
  ok: z.literal(true),
  feedback: z.enum(["positive", "negative"]),
});

export const widgetSignRequestSchema = z.object({
  assistantId: z.string().min(1),
  visitorId: z.string().min(8).max(80),
});

export const widgetSignResponseSchema = z.object({
  timestamp: z.number().int(),
  signature: z.string(),
});

export const voiceSessionCreateRequestSchema = z.object({
  assistantId: z.string().min(1, "assistantId is required"),
  // Never trim: SDP lines are CRLF-terminated and providers reject a truncated final line.
  sdpOffer: z.string().refine((value) => value.trim().length > 0, "sdpOffer is required"),
  visitorId: z.string().min(1).max(80).optional(),
  conversationId: z.string().min(1).optional(),
  source: z.enum(["playground", "widget", "api"]).optional(),
  recordingConsent: z.boolean().optional(),
  history: conversationHistorySchema.optional(),
  /** `heartbeat`: the client sends control heartbeats and receives a `controlToken`. */
  capabilities: z.array(z.enum(["heartbeat"])).max(4).optional(),
});

export const voiceSessionCreateResponseSchema = z.object({
  sessionId: z.string(),
  sdpAnswer: z.string(),
  providerSessionId: z.string(),
  ephemeral: z.boolean(),
  /** Voice turns are saved as text in the conversation (independent of audio). */
  transcriptSaved: z.boolean(),
  /** Session audio is being recorded (owner-only playback). Requires prior consent. */
  recording: z.boolean(),
  /** Durable conversation for voice turns and/or the recording; null when ephemeral or nothing is saved. */
  conversationId: z.string().nullable(),
  model: z.string(),
  voiceId: z.string(),
  /** Session-scoped heartbeat authorization (not a provider credential); only with the `heartbeat` capability. */
  controlToken: z.string().optional(),
  heartbeatIntervalMs: z.number().int().positive().optional(),
});

export const voiceSessionHeartbeatRequestSchema = z.object({
  token: z.string().min(1).max(1_024),
});

export const voiceSessionHeartbeatResponseSchema = z.object({
  /** `degraded`: ChatAI is reconnecting its control link; `lost`: the session is being ended. */
  state: z.enum(["healthy", "degraded", "ended", "lost"]),
  nextHeartbeatMs: z.number().int().positive(),
  endReason: z.string().nullable().optional(),
});

export const voiceSessionEndRequestSchema = z.object({
  reason: z
    .enum(["close_requested", "remote_hangup", "connection_lost", "error"])
    .optional(),
  visitorId: z.string().min(1).max(80).optional(),
  source: z.enum(["playground", "widget", "api"]).optional(),
});

export const voiceSessionEndResponseSchema = z.object({
  sessionId: z.string(),
  status: z.enum(["connecting", "connected", "ending", "ended", "failed"]),
  billableSeconds: z.number().int().nonnegative(),
  usageFinalized: z.boolean(),
  usageIncomplete: z.boolean(),
  ephemeral: z.boolean(),
  closeReason: z.string().optional(),
  /**
   * Set when ChatAI ended the session. Widget callers only see the neutral reasons
   * (`voice_unavailable`, `superseded`, `idle`, `disconnected`, `max_duration`); owners
   * also see `usage_limit`, `heartbeat_lost`, `control_lost` and `shutdown`.
   */
  endReason: z
    .enum([
      "usage_limit",
      "voice_unavailable",
      "superseded",
      "idle",
      "disconnected",
      "max_duration",
      "heartbeat_lost",
      "control_lost",
      "shutdown",
    ])
    .nullable()
    .optional(),
});

/** Mint refused before any provider session was created. */
export const voiceSessionRefusalSchema = z.object({
  error: z.string(),
  reason: z.enum(["voice_minutes_exhausted", "voice_concurrency_limit", "voice_unavailable"]).optional(),
});

export type AssistantCreateInput = z.infer<typeof assistantCreateSchema>;
export type AssistantPatchInput = z.infer<typeof assistantPatchSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type Assistant = z.infer<typeof assistantSchema>;
export type Document = z.infer<typeof documentSchema>;
export type VoiceSessionCreateInput = z.infer<typeof voiceSessionCreateRequestSchema>;
export type VoiceSessionEndInput = z.infer<typeof voiceSessionEndRequestSchema>;
