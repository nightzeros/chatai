CREATE TYPE "public"."eval_run_kind" AS ENUM('online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."eval_run_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"eval_set_id" text NOT NULL,
	"question" text NOT NULL,
	"expected_answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"eval_set_id" text,
	"kind" "eval_run_kind" NOT NULL,
	"status" "eval_run_status" DEFAULT 'pending' NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"message_id" text,
	"case_id" text,
	"metric" text NOT NULL,
	"score" double precision NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"assistant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text,
	"run_id" text,
	"case_id" text,
	"status" "ingest_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_jobs_target_keys" CHECK ((
        ("eval_jobs"."message_id" IS NOT NULL AND "eval_jobs"."run_id" IS NULL AND "eval_jobs"."case_id" IS NULL)
        OR ("eval_jobs"."run_id" IS NOT NULL AND "eval_jobs"."case_id" IS NOT NULL AND "eval_jobs"."message_id" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "assistants" ADD COLUMN "rag_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "parent_chunk_id" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "parent_content" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_eval_set_id_eval_sets_id_fk" FOREIGN KEY ("eval_set_id") REFERENCES "public"."eval_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_eval_set_id_eval_sets_id_fk" FOREIGN KEY ("eval_set_id") REFERENCES "public"."eval_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_sets" ADD CONSTRAINT "eval_sets_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_jobs" ADD CONSTRAINT "eval_jobs_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_jobs" ADD CONSTRAINT "eval_jobs_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_jobs" ADD CONSTRAINT "eval_jobs_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_eval_set_id_idx" ON "eval_cases" USING btree ("eval_set_id");--> statement-breakpoint
CREATE INDEX "eval_runs_assistant_id_created_at_idx" ON "eval_runs" USING btree ("assistant_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_eval_set_id_idx" ON "eval_runs" USING btree ("eval_set_id");--> statement-breakpoint
CREATE INDEX "eval_scores_run_id_idx" ON "eval_scores" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_scores_message_id_idx" ON "eval_scores" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "eval_scores_case_id_idx" ON "eval_scores" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "eval_sets_assistant_id_updated_at_idx" ON "eval_sets" USING btree ("assistant_id","updated_at");--> statement-breakpoint
CREATE INDEX "eval_jobs_status_locked_at_idx" ON "eval_jobs" USING btree ("status","locked_at");--> statement-breakpoint
CREATE INDEX "eval_jobs_message_id_idx" ON "eval_jobs" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "eval_jobs_run_id_idx" ON "eval_jobs" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_parent_chunk_id_chunks_id_fk" FOREIGN KEY ("parent_chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_parent_chunk_id_idx" ON "chunks" USING btree ("parent_chunk_id");--> statement-breakpoint
CREATE INDEX "chunks_search_vector_gin_idx" ON "chunks" USING gin ("search_vector");