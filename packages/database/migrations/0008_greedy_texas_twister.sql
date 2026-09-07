CREATE TYPE "public"."usage_billing_mode" AS ENUM('hosted', 'byok');--> statement-breakpoint
CREATE TYPE "public"."usage_event_status" AS ENUM('shadow', 'reserved', 'completed', 'failed', 'abandoned', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."usage_operation" AS ENUM('chat_completion', 'embedding', 'rerank');--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_code" text PRIMARY KEY NOT NULL,
	"monthly_limit_micros" bigint NOT NULL,
	"monthly_request_cap" integer,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_period_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"limit_micros" bigint NOT NULL,
	"consumed_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"assistant_id" text,
	"request_id" text NOT NULL,
	"idempotency_key" text,
	"operation" "usage_operation" NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"billing_mode" "usage_billing_mode" DEFAULT 'hosted' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"reserved_cost_micros" bigint DEFAULT 0 NOT NULL,
	"final_cost_micros" bigint DEFAULT 0 NOT NULL,
	"pricing_snapshot" jsonb,
	"status" "usage_event_status" DEFAULT 'shadow' NOT NULL,
	"error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "usage_period_balances" ADD CONSTRAINT "usage_period_balances_account_id_hosting_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."hosting_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_account_id_hosting_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."hosting_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_period_balances_account_period_uidx" ON "usage_period_balances" USING btree ("account_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_idempotency_key_uidx" ON "usage_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_events_account_created_at_idx" ON "usage_events" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_request_id_idx" ON "usage_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "usage_events_assistant_created_at_idx" ON "usage_events" USING btree ("assistant_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_status_created_at_idx" ON "usage_events" USING btree ("status","created_at");--> statement-breakpoint
-- Seed default free plan ($5.00 / month provider-cost ceiling). Override per-account via
-- hosting_accounts.limit_override_micros or update this row; env HOSTED_USAGE_DEFAULT_LIMIT_MICROS
-- is a runtime fallback when the plan row is missing.
INSERT INTO "plan_entitlements" ("plan_code", "monthly_limit_micros", "monthly_request_cap", "features")
VALUES ('free', 5000000, NULL, '{}'::jsonb)
ON CONFLICT ("plan_code") DO NOTHING;
