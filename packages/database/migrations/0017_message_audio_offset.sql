-- Phase 8: Voice conversation review. Additive only.
-- Where a stored Voice turn starts in its call's recording (ms on the provider session
-- timeline). Navigation metadata only; existing rows stay NULL (no backfill).
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "audio_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_audio_offset_ms_check" CHECK ("messages"."audio_offset_ms" IS NULL OR "messages"."audio_offset_ms" >= 0);
