-- Assistant Profile: owner-authored Purpose (scope authority) and owner-reviewed Key facts.
-- Additive only. No backfill: assistants without a row keep today's behavior.
CREATE TYPE "public"."profile_refresh_status" AS ENUM('idle', 'pending', 'running', 'failed');--> statement-breakpoint
CREATE TYPE "public"."profile_job_kind" AS ENUM('facts', 'purpose');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_profiles" (
	"assistant_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"purpose" jsonb,
	"purpose_suggestion" jsonb,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts_published_at" timestamp with time zone,
	"refresh_status" "profile_refresh_status" DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"refreshed_at" timestamp with time zone,
	"knowledge_fingerprint" text,
	"refresh_day" date,
	"refreshes_today" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_profiles_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_profile_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"kind" "profile_job_kind" NOT NULL,
	"reason" text NOT NULL,
	"status" "ingest_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_profile_jobs_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_profile_jobs_status_idx" ON "assistant_profile_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "assistant_profile_jobs_one_pending" ON "assistant_profile_jobs" USING btree ("assistant_id","kind") WHERE "assistant_profile_jobs"."status" = 'pending';
