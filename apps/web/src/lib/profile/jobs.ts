import { sql, type Database } from "@chatai/database";

import { createId } from "@/lib/ids";

/** Bulk Knowledge changes collapse into one refresh that runs after this delay. */
export const PROFILE_REFRESH_DEBOUNCE_MS = 60_000;
/** Knowledge-change refreshes per assistant per UTC day (owner-triggered runs are not capped). */
export const PROFILE_REFRESH_DAILY_CAP = 24;

export type ProfileJobReason = "owner" | "knowledge_change";

/**
 * Queue a Key-facts refresh. At most one pending job per assistant: a second
 * request while one is pending is a no-op (the pending job will see the latest
 * Knowledge when it runs).
 */
export async function enqueueProfileFactsJob(
  db: Database,
  assistantId: string,
  reason: ProfileJobReason,
): Promise<boolean> {
  const delayMs = reason === "owner" ? 0 : PROFILE_REFRESH_DEBOUNCE_MS;
  const rows = (await db.execute(sql`
    INSERT INTO assistant_profile_jobs (id, assistant_id, kind, reason, status, run_after)
    VALUES (${createId()}, ${assistantId}, 'facts', ${reason}, 'pending', now() + (${delayMs} * interval '1 millisecond'))
    ON CONFLICT (assistant_id, kind) WHERE status = 'pending' DO NOTHING
    RETURNING id
  `)) as unknown as Array<{ id: string }>;
  if (rows.length === 0 && reason === "owner") {
    // An owner request runs now even if a debounced Knowledge refresh is waiting.
    await db.execute(sql`
      UPDATE assistant_profile_jobs SET run_after = now(), reason = 'owner', updated_at = now()
      WHERE assistant_id = ${assistantId} AND kind = 'facts' AND status = 'pending'
    `);
  }
  return rows.length > 0;
}

/**
 * Knowledge changed (document ready, failed, deleted, excluded, re-synced). Only
 * assistants whose owner already published Key facts get a debounced refresh; the
 * first generation is always owner-triggered. Never throws: Knowledge operations
 * must not fail because of the profile.
 */
export async function onKnowledgeChanged(db: Database, assistantId: string): Promise<void> {
  try {
    const rows = (await db.execute(sql`
      SELECT 1 AS ok FROM assistant_profiles
      WHERE assistant_id = ${assistantId} AND facts_published_at IS NOT NULL
      LIMIT 1
    `)) as unknown as Array<{ ok: number }>;
    if (rows.length === 0) return;
    await enqueueProfileFactsJob(db, assistantId, "knowledge_change");
    const { startProfileWorker } = await import("./worker");
    startProfileWorker();
  } catch {
    // Missing table before migration 0020, or a transient DB error: skip the refresh.
  }
}
