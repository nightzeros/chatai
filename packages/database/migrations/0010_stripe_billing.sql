-- Stripe billing integration: events dedup + plan tiers

CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Add pro and team plans (free already seeded in 0008)
INSERT INTO "plan_entitlements" ("plan_code", "monthly_limit_micros", "monthly_request_cap", "features")
VALUES
  ('pro', 25000000, NULL, '{"evals": true, "maxAssistants": 20}'),
  ('team', 100000000, NULL, '{"evals": true, "maxAssistants": 100, "teamMembers": true}')
ON CONFLICT ("plan_code") DO NOTHING;
