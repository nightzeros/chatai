import { sql } from "@chatai/database";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { evaluateRateLimit, minuteWindowStart } from "@/lib/rate-limit-window";

export async function consumeApiKeyRateLimit(apiKeyId: string, now = new Date()) {
  const windowStart = minuteWindowStart(now);
  // postgres.js Bind cannot serialize JS Date params from drizzle `sql` templates.
  // Typed column writes use toISOString(); keep the same encoding here.
  const [row] = await db().execute<{ count: number }>(sql`
    INSERT INTO api_key_rate_buckets (api_key_id, window_start, count)
    VALUES (${apiKeyId}, ${windowStart.toISOString()}, 1)
    ON CONFLICT (api_key_id, window_start)
    DO UPDATE SET count = api_key_rate_buckets.count + 1
    RETURNING count
  `);

  if (!row) {
    throw new Error("Rate limit increment failed.");
  }

  return evaluateRateLimit(Number(row.count), env.API_RATE_LIMIT_PER_MINUTE, windowStart, now);
}
