-- Voice V1 schema foundation (additive, backward compatible)
-- Ephemeral sessions + durable metadata; no audio blobs in Postgres.

CREATE TYPE "public"."voice_session_status" AS ENUM('connecting', 'connected', 'ended', 'failed');--> statement-breakpoint
CREATE TYPE "public"."voice_session_source" AS ENUM('playground', 'widget', 'api');--> statement-breakpoint
CREATE TYPE "public"."voice_recording_kind" AS ENUM('user_segment', 'assistant_segment', 'mix');--> statement-breakpoint
CREATE TYPE "public"."voice_event_type" AS ENUM('session.started', 'session.ended', 'user.speech.started', 'user.speech.ended', 'transcript.final', 'rag.started', 'rag.completed', 'assistant.response.started', 'assistant.audio.started', 'assistant.audio.stopped', 'assistant.interrupted', 'session.reconnecting', 'error');--> statement-breakpoint
CREATE TYPE "public"."message_modality" AS ENUM('text', 'voice');--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"conversation_id" text,
	"visitor_id" text,
	"source" "voice_session_source" DEFAULT 'widget' NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"status" "voice_session_status" DEFAULT 'connecting' NOT NULL,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"model" text,
	"voice_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"interrupt_count" integer DEFAULT 0 NOT NULL,
	"ttfa_ms" integer,
	"error_code" text,
	"recording_consent_at" timestamp with time zone,
	"billable_seconds" integer,
	"usage_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"type" "voice_event_type" NOT NULL,
	"offset_ms" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"conversation_id" text,
	"kind" "voice_recording_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text,
	"byte_size" bigint,
	"start_ms" integer,
	"end_ms" integer,
	"turn_index" integer,
	"interrupted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "voice_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "modality" "message_modality" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "was_interrupted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "voice_session_id" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_events" ADD CONSTRAINT "voice_events_session_id_voice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD CONSTRAINT "voice_recordings_session_id_voice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD CONSTRAINT "voice_recordings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_voice_session_id_voice_sessions_id_fk" FOREIGN KEY ("voice_session_id") REFERENCES "public"."voice_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_sessions_assistant_id_started_at_idx" ON "voice_sessions" USING btree ("assistant_id","started_at");--> statement-breakpoint
CREATE INDEX "voice_sessions_conversation_id_idx" ON "voice_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "voice_sessions_provider_session_id_idx" ON "voice_sessions" USING btree ("provider_session_id");--> statement-breakpoint
CREATE INDEX "voice_sessions_ephemeral_ended_at_idx" ON "voice_sessions" USING btree ("ephemeral","ended_at");--> statement-breakpoint
CREATE INDEX "voice_events_session_id_created_at_idx" ON "voice_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "voice_events_session_id_type_idx" ON "voice_events" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "voice_recordings_session_id_idx" ON "voice_recordings" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "voice_recordings_conversation_id_idx" ON "voice_recordings" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "voice_recordings_storage_key_idx" ON "voice_recordings" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "messages_voice_session_id_idx" ON "messages" USING btree ("voice_session_id");
