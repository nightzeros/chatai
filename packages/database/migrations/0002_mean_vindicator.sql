CREATE TYPE "public"."source_status" AS ENUM('pending', 'syncing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('website');--> statement-breakpoint
CREATE TYPE "public"."ingest_job_kind" AS ENUM('ingest', 'sync');--> statement-breakpoint
ALTER TYPE "public"."document_type" ADD VALUE 'url';--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"type" "source_type" DEFAULT 'website' NOT NULL,
	"name" text NOT NULL,
	"origin_key" text NOT NULL,
	"config" jsonb NOT NULL,
	"status" "source_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"last_synced_at" timestamp with time zone,
	"schedule_cron" text,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingest_jobs" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN "kind" "ingest_job_kind" DEFAULT 'ingest' NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sources_assistant_id_updated_at_idx" ON "sources" USING btree ("assistant_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_assistant_id_origin_key_uidx" ON "sources" USING btree ("assistant_id","origin_key");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_source_id_url_uidx" ON "documents" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "ingest_jobs_source_id_idx" ON "ingest_jobs" USING btree ("source_id");--> statement-breakpoint
ALTER TABLE "ingest_jobs" ADD CONSTRAINT "ingest_jobs_kind_keys" CHECK ((
        ("ingest_jobs"."kind" = 'ingest' AND "ingest_jobs"."document_id" IS NOT NULL)
        OR ("ingest_jobs"."kind" = 'sync' AND "ingest_jobs"."source_id" IS NOT NULL)
      ));