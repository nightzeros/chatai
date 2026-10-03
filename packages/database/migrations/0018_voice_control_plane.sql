-- Phase 9: Voice control plane. Additive only (nullable or defaulted, no backfill).
-- runtime_instance_id: the process that owns the live runtime (random id per boot).
-- recovery_claimed_at: conditional claim so only one recovery attach runs per orphan.
-- timeline_version: 1 = visitor audio anchored on arrival (every existing recording).
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "runtime_instance_id" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "recovery_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "timeline_version" smallint DEFAULT 1 NOT NULL;
