-- Phase 7: Voice usage minutes. Additive only.
-- New enum values are added here but never used in this file: pending migrations run in
-- one transaction and Postgres forbids using a value added in the same transaction.
-- Voice pricing rows come from the billing seed catalog at runtime (merged when missing).
ALTER TYPE "public"."usage_operation" ADD VALUE IF NOT EXISTS 'voice_realtime';--> statement-breakpoint
ALTER TYPE "public"."model_pricing_operation" ADD VALUE IF NOT EXISTS 'voice_realtime';--> statement-breakpoint
ALTER TYPE "public"."model_pricing_unit" ADD VALUE IF NOT EXISTS 'per_minute';--> statement-breakpoint
CREATE TYPE "public"."voice_metering_status" AS ENUM('open', 'settled', 'estimated', 'not_billable', 'legacy');--> statement-breakpoint
-- Existing sessions predate metering: backfilled as legacy (never billed, excluded from quotas).
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "metering_status" "voice_metering_status" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ALTER COLUMN "metering_status" SET DEFAULT 'open';--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "metering_mode" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "hosting_account_id" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "usage_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "connected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "provider_usage_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "usage_checkpoint_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "voice_seconds" integer;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "voice_seconds_granted" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "quota_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "usage_measurement" text;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD COLUMN IF NOT EXISTS "usage_settled_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_hosting_account_id_hosting_accounts_id_fk" FOREIGN KEY ("hosting_account_id") REFERENCES "public"."hosting_accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_sessions_metering_status_checkpoint_idx" ON "voice_sessions" USING btree ("metering_status","usage_checkpoint_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "voice_sessions_account_metering_status_idx" ON "voice_sessions" USING btree ("hosting_account_id","metering_status");--> statement-breakpoint
ALTER TABLE "usage_period_balances" ADD COLUMN IF NOT EXISTS "voice_seconds_limit" integer;--> statement-breakpoint
ALTER TABLE "usage_period_balances" ADD COLUMN IF NOT EXISTS "voice_seconds_reserved" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_period_balances" ADD COLUMN IF NOT EXISTS "voice_seconds_consumed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Provisional development allowances (not commercial pricing). Only fills keys that are absent.
UPDATE "plan_entitlements"
SET "features" = jsonb_build_object('voiceMinutesMonthly', v.minutes, 'maxConcurrentVoiceSessions', v.concurrent) || "features",
    "updated_at" = now()
FROM (VALUES ('free', 10, 1), ('starter', 120, 2), ('pro', 600, 5), ('business', 2000, 10)) AS v(plan_code, minutes, concurrent)
WHERE "plan_entitlements"."plan_code" = v.plan_code;--> statement-breakpoint
-- One-time: freeze the current period's Voice entitlement from the plan.
UPDATE "usage_period_balances" AS upb
SET "voice_seconds_limit" = ((pe."features"->>'voiceMinutesMonthly')::integer) * 60
FROM "hosting_accounts" AS ha
JOIN "plan_entitlements" AS pe ON pe."plan_code" = ha."plan_code"
WHERE upb."account_id" = ha."id"
  AND upb."period_end" > now()
  AND pe."features" ? 'voiceMinutesMonthly'
  AND jsonb_typeof(pe."features"->'voiceMinutesMonthly') = 'number';
