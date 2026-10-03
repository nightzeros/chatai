-- Phase 6: recording lifecycle. Additive only; no existing rows carry recordings yet.
CREATE TYPE "public"."voice_recording_status" AS ENUM('pending', 'ready', 'failed', 'expired', 'deleting');--> statement-breakpoint
ALTER TABLE "voice_recordings" ALTER COLUMN "storage_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "status" "voice_recording_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "error_code" text;--> statement-breakpoint
ALTER TABLE "voice_recordings" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_recordings_status_expires_at_idx" ON "voice_recordings" USING btree ("status","expires_at");
