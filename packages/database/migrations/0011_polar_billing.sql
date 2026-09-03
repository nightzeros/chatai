-- Polar billing: rename Stripe columns/table from earlier prep migrations

ALTER TABLE "hosting_accounts" RENAME COLUMN "stripe_customer_id" TO "polar_customer_id";
ALTER TABLE "hosting_accounts" RENAME COLUMN "stripe_subscription_id" TO "polar_subscription_id";

ALTER TABLE IF EXISTS "stripe_events" RENAME TO "polar_events";
