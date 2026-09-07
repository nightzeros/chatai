CREATE TYPE "public"."hosting_account_status" AS ENUM('active', 'suspended', 'disabled');--> statement-breakpoint
CREATE TABLE "hosting_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "hosting_account_status" DEFAULT 'active' NOT NULL,
	"plan_code" text DEFAULT 'free' NOT NULL,
	"period_anchor" timestamp with time zone NOT NULL,
	"limit_override_micros" bigint,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hosting_accounts" ADD CONSTRAINT "hosting_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hosting_accounts_user_id_uidx" ON "hosting_accounts" USING btree ("user_id");