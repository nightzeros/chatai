CREATE TYPE "public"."assistant_provider_secret_kind" AS ENUM('chat', 'embedding');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "widget_rate_buckets" (
	"scope" text NOT NULL,
	"scope_key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "widget_rate_buckets_scope_scope_key_window_start_pk" PRIMARY KEY("scope","scope_key","window_start")
);
--> statement-breakpoint
CREATE TABLE "assistant_provider_secrets" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"kind" "assistant_provider_secret_kind" NOT NULL,
	"provider" text NOT NULL,
	"ciphertext" text NOT NULL,
	"key_prefix" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "security_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "privacy_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_provider_secrets" ADD CONSTRAINT "assistant_provider_secrets_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_user_id_created_at_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "assistant_provider_secrets_assistant_id_kind_uidx" ON "assistant_provider_secrets" USING btree ("assistant_id","kind");