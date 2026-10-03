-- Shared assistant scope enforcement: a request outside the assistant's purpose gets a
-- short redirect. Owner-visible only; public chat meta reports it as conversational.
-- Additive only; existing rows and analytics sets are unchanged.
ALTER TYPE "public"."message_outcome" ADD VALUE IF NOT EXISTS 'out_of_scope';
