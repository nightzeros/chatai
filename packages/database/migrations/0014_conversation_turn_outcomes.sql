-- Phase 4.5: turns that do not need retrieval are still persisted with a distinct outcome.
-- Additive only; existing rows and analytics sets are unchanged.
ALTER TYPE "public"."message_outcome" ADD VALUE IF NOT EXISTS 'conversational';--> statement-breakpoint
ALTER TYPE "public"."message_outcome" ADD VALUE IF NOT EXISTS 'answered_from_history';
