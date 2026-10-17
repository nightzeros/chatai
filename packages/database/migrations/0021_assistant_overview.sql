-- Approved/suggested overview claims on assistant profiles (claim-linked to key facts).
-- Additive only; null overview keeps today's behavior.
ALTER TABLE "assistant_profiles" ADD COLUMN IF NOT EXISTS "overview" jsonb;
