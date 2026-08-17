ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "origin_key" text;--> statement-breakpoint
UPDATE "sources"
SET "origin_key" = lower(
  (regexp_match(
    regexp_replace(
      regexp_replace(
        CASE
          WHEN config->>'startUrl' LIKE 'http://%' OR config->>'startUrl' LIKE 'https://%' THEN config->>'startUrl'
          ELSE 'https://' || (config->>'startUrl')
        END,
        '[?#].*$',
        ''
      ),
      '/+$',
      ''
    ),
    '^(https?://[^/?#]+)'
  ))[1]
)
WHERE "origin_key" IS NULL
  AND config->>'startUrl' IS NOT NULL;--> statement-breakpoint
UPDATE "sources"
SET "origin_key" = regexp_replace("origin_key", ':443$', '')
WHERE "origin_key" LIKE 'https:%:443';--> statement-breakpoint
UPDATE "sources"
SET "origin_key" = regexp_replace("origin_key", ':80$', '')
WHERE "origin_key" LIKE 'http:%:80';--> statement-breakpoint
DELETE FROM "sources" AS duplicate
USING "sources" AS keeper
WHERE duplicate.assistant_id = keeper.assistant_id
  AND duplicate.origin_key = keeper.origin_key
  AND duplicate.origin_key IS NOT NULL
  AND duplicate.created_at > keeper.created_at;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "origin_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sources_assistant_id_origin_key_uidx" ON "sources" USING btree ("assistant_id","origin_key");
