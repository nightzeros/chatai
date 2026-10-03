import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  bigint,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { conversations } from "./conversations";
import { hostingAccounts } from "./hosting-accounts";

/**
 * Durable lifecycle / debugging events only — not high-volume transcript.partial
 * or reflected audio deltas (those stay ephemeral or go to object storage later).
 */
export const VOICE_EVENT_TYPES = [
  "session.started",
  "session.ended",
  "user.speech.started",
  "user.speech.ended",
  "transcript.final",
  "rag.started",
  "rag.completed",
  "assistant.response.started",
  "assistant.audio.started",
  "assistant.audio.stopped",
  "assistant.interrupted",
  "session.reconnecting",
  "error",
] as const;

export type VoiceEventType = (typeof VOICE_EVENT_TYPES)[number];

export const voiceSessionStatusEnum = pgEnum("voice_session_status", [
  "connecting",
  "connected",
  "ended",
  "failed",
]);

export const voiceSessionSourceEnum = pgEnum("voice_session_source", [
  "playground",
  "widget",
  "api",
]);

export const voiceRecordingKindEnum = pgEnum("voice_recording_kind", [
  "user_segment",
  "assistant_segment",
  "mix",
]);

/**
 * pending: recording or finalizing; ready: object stored; failed: nothing stored;
 * expired: object removed by recording retention (row kept as a tombstone);
 * deleting: object removal pending retry (row detached from its conversation).
 */
export const voiceRecordingStatusEnum = pgEnum("voice_recording_status", [
  "pending",
  "ready",
  "failed",
  "expired",
  "deleting",
]);

export const voiceEventTypeEnum = pgEnum("voice_event_type", [...VOICE_EVENT_TYPES]);

/**
 * Usage metering lifecycle of a session. `open` is the only non-terminal state;
 * leaving it is the single settlement claim (exactly once per session).
 * legacy: sessions created before metering existed (never billed).
 */
export const voiceMeteringStatusEnum = pgEnum("voice_metering_status", [
  "open",
  "settled",
  "estimated",
  "not_billable",
  "legacy",
]);

export type VoiceSessionStatus = (typeof voiceSessionStatusEnum.enumValues)[number];
export type VoiceMeteringStatus = (typeof voiceMeteringStatusEnum.enumValues)[number];
export type VoiceUsageMeasurement = "provider_final" | "provider_checkpoint" | "none";
export type VoiceMeteringMode = "enforce" | "shadow" | "off";
export type VoiceSessionSource = (typeof voiceSessionSourceEnum.enumValues)[number];
export type VoiceRecordingKind = (typeof voiceRecordingKindEnum.enumValues)[number];
export type VoiceRecordingStatus = (typeof voiceRecordingStatusEnum.enumValues)[number];

/**
 * Realtime voice session. Ephemeral sessions may be omitted from durable storage
 * by the application, or inserted with ephemeral=true and deleted on end.
 * conversationId is null for ephemeral / unbound sessions.
 */
export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    /** Null when ephemeral or not yet bound to a durable conversation. */
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    visitorId: text("visitor_id"),
    source: voiceSessionSourceEnum("source").notNull().default("widget"),
    /** Provider registry id (e.g. gpt-live). */
    provider: text("provider").notNull(),
    /** Opaque provider session id (e.g. OpenAI Live session id). */
    providerSessionId: text("provider_session_id"),
    status: voiceSessionStatusEnum("status").notNull().default("connecting"),
    /**
     * When true, no transcripts/recordings/messages should be retained after end.
     * Forced true whenever privacy.storeConversations is false.
     */
    ephemeral: boolean("ephemeral").notNull().default(false),
    model: text("model"),
    voiceId: text("voice_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    interruptCount: integer("interrupt_count").notNull().default(0),
    /** Optional rollup; detailed timings live in voice_events metadata. */
    ttfaMs: integer("ttfa_ms"),
    errorCode: text("error_code"),
    recordingConsentAt: timestamp("recording_consent_at", { withTimezone: true }),
    /** Provider billable seconds at settlement (includes the provider's init charge). */
    billableSeconds: integer("billable_seconds"),
    /** Provider-cost ledger row (`usage_events`, operation voice_realtime). */
    usageEventId: text("usage_event_id"),
    meteringStatus: voiceMeteringStatusEnum("metering_status").notNull().default("open"),
    /** Metering mode captured at admission; settlement follows it even if env changes. */
    meteringMode: text("metering_mode").$type<VoiceMeteringMode>(),
    hostingAccountId: text("hosting_account_id").references(() => hostingAccounts.id, {
      onDelete: "set null",
    }),
    /** Billing period the grant was reserved in; settlement counts usage there. */
    usagePeriodStart: timestamp("usage_period_start", { withTimezone: true }),
    /** First media evidence (speech, transcript, assistant output). */
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** Durable monotonic checkpoint of the provider's cumulative usage snapshot. */
    providerUsageSeconds: integer("provider_usage_seconds").notNull().default(0),
    /** Last checkpoint / liveness heartbeat from the owning process. */
    usageCheckpointAt: timestamp("usage_checkpoint_at", { withTimezone: true }),
    /** Customer Voice seconds (entitlement measure); set at settlement. */
    voiceSeconds: integer("voice_seconds"),
    /** Voice seconds currently reserved against the period balance for this session. */
    voiceSecondsGranted: integer("voice_seconds_granted").notNull().default(0),
    /** Measured but not counted toward the Voice-minute quota (owner playground). */
    quotaExempt: boolean("quota_exempt").notNull().default(false),
    usageMeasurement: text("usage_measurement").$type<VoiceUsageMeasurement>(),
    usageSettledAt: timestamp("usage_settled_at", { withTimezone: true }),
    /** Process that owns the live runtime (random id per boot); routes heartbeats. */
    runtimeInstanceId: text("runtime_instance_id"),
    /** Conditional claim: only one recovery attach per orphaned session. */
    recoveryClaimedAt: timestamp("recovery_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("voice_sessions_assistant_id_started_at_idx").on(table.assistantId, table.startedAt),
    index("voice_sessions_conversation_id_idx").on(table.conversationId),
    index("voice_sessions_provider_session_id_idx").on(table.providerSessionId),
    index("voice_sessions_ephemeral_ended_at_idx").on(table.ephemeral, table.endedAt),
    index("voice_sessions_metering_status_checkpoint_idx").on(
      table.meteringStatus,
      table.usageCheckpointAt,
    ),
    index("voice_sessions_account_metering_status_idx").on(
      table.hostingAccountId,
      table.meteringStatus,
    ),
  ],
);

export const voiceEvents = pgTable(
  "voice_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => voiceSessions.id, { onDelete: "cascade" }),
    type: voiceEventTypeEnum("type").notNull(),
    /** Wall-clock milliseconds since voice_sessions.started_at. */
    offsetMs: integer("offset_ms"),
    /** Small structured payload — never store raw audio or high-volume deltas. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("voice_events_session_id_created_at_idx").on(table.sessionId, table.createdAt),
    index("voice_events_session_id_type_idx").on(table.sessionId, table.type),
  ],
);

/**
 * Object-storage references only — no audio blobs in Postgres.
 * Retention/delete workers list storageKey then delete objects, then rows.
 */
export const voiceRecordings = pgTable(
  "voice_recordings",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => voiceSessions.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    kind: voiceRecordingKindEnum("kind").notNull(),
    /**
     * Opaque key for ObjectStorageProvider (S3/R2/MinIO) — not a filesystem path.
     * Null once the object is gone (failed / expired tombstones). Never sent to browsers.
     */
    storageKey: text("storage_key"),
    status: voiceRecordingStatusEnum("status").notNull().default("pending"),
    contentType: text("content_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    durationMs: integer("duration_ms"),
    /** Finalized from the crash-recovery spool after an abnormal termination. */
    partial: boolean("partial").notNull().default(false),
    /** 1 = visitor audio anchored on arrival (all recordings so far). */
    timelineVersion: smallint("timeline_version").notNull().default(1),
    startMs: integer("start_ms"),
    endMs: integer("end_ms"),
    turnIndex: integer("turn_index"),
    interrupted: boolean("interrupted").notNull().default(false),
    /** Recording retention deadline; null = kept as long as the conversation. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("voice_recordings_session_id_idx").on(table.sessionId),
    index("voice_recordings_conversation_id_idx").on(table.conversationId),
    index("voice_recordings_storage_key_idx").on(table.storageKey),
    index("voice_recordings_status_expires_at_idx").on(table.status, table.expiresAt),
  ],
);

export const voiceSessionsRelations = relations(voiceSessions, ({ one, many }) => ({
  assistant: one(assistants, {
    fields: [voiceSessions.assistantId],
    references: [assistants.id],
  }),
  conversation: one(conversations, {
    fields: [voiceSessions.conversationId],
    references: [conversations.id],
  }),
  events: many(voiceEvents),
  recordings: many(voiceRecordings),
}));

export const voiceEventsRelations = relations(voiceEvents, ({ one }) => ({
  session: one(voiceSessions, {
    fields: [voiceEvents.sessionId],
    references: [voiceSessions.id],
  }),
}));

export const voiceRecordingsRelations = relations(voiceRecordings, ({ one }) => ({
  session: one(voiceSessions, {
    fields: [voiceRecordings.sessionId],
    references: [voiceSessions.id],
  }),
  conversation: one(conversations, {
    fields: [voiceRecordings.conversationId],
    references: [conversations.id],
  }),
}));
