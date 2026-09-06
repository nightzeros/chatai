-- SaaS plan ladder: free / starter / pro / business
-- Tightens Free limits; migrates legacy `team` → `business`.

-- Insert new tiers (idempotent)
INSERT INTO "plan_entitlements" ("plan_code", "monthly_limit_micros", "monthly_request_cap", "features")
VALUES
  ('starter', 12000000, 2000, '{"maxAssistants": 5, "evalsEnabled": false}'::jsonb),
  ('business', 150000000, 50000, '{"maxAssistants": 100, "evalsEnabled": true, "teamMembers": true}'::jsonb)
ON CONFLICT ("plan_code") DO UPDATE SET
  "monthly_limit_micros" = EXCLUDED."monthly_limit_micros",
  "monthly_request_cap" = EXCLUDED."monthly_request_cap",
  "features" = EXCLUDED."features",
  "updated_at" = now();

-- Tighten Free + update Pro (upsert so existing DBs pick up new limits)
INSERT INTO "plan_entitlements" ("plan_code", "monthly_limit_micros", "monthly_request_cap", "features")
VALUES
  ('free', 1000000, 75, '{"maxAssistants": 1, "evalsEnabled": false}'::jsonb),
  ('pro', 45000000, 15000, '{"maxAssistants": 20, "evalsEnabled": true}'::jsonb)
ON CONFLICT ("plan_code") DO UPDATE SET
  "monthly_limit_micros" = EXCLUDED."monthly_limit_micros",
  "monthly_request_cap" = EXCLUDED."monthly_request_cap",
  "features" = EXCLUDED."features",
  "updated_at" = now();

-- Migrate accounts on legacy `team` plan
UPDATE "hosting_accounts"
SET "plan_code" = 'business', "updated_at" = now()
WHERE "plan_code" = 'team';

-- Drop legacy team entitlement row if present
DELETE FROM "plan_entitlements" WHERE "plan_code" = 'team';

-- Refresh current-period limits for accounts without admin overrides
-- (do not reset consumed/reserved spend)
UPDATE "usage_period_balances" AS upb
SET "limit_micros" = pe."monthly_limit_micros"
FROM "hosting_accounts" AS ha
JOIN "plan_entitlements" AS pe ON pe."plan_code" = ha."plan_code"
WHERE upb."account_id" = ha."id"
  AND ha."limit_override_micros" IS NULL
  AND upb."period_end" > now();
