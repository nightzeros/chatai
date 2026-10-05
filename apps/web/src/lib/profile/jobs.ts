import {
  and,
  assistantProfileJobs,
  assistantProfiles,
  eq,
  gte,
  inArray,
  lt,
  sql,
  type Database,
} from "@chatai/database";

import { createId } from "@/lib/ids";

/** Bulk Knowledge changes collapse into one refresh that runs after this delay. */
export const PROFILE_REFRESH_DEBOUNCE_MS = 60_000;
/** Knowledge-change refreshes per assistant per UTC day (owner-triggered runs are not capped). */
export const PROFILE_REFRESH_DAILY_CAP = 24;
export const PROFILE_JOB_MAX_ATTEMPTS = 3;
/** A claim not renewed for this long is treated as a crashed worker and may be reclaimed. */
export const PROFILE_JOB_LEASE_MINUTES = 5;
/** Must stay well below the lease so a live worker never loses its claim mid-generation. */
export const PROFILE_GENERATION_TIMEOUT_MS = 120_000;
const RETRY_BASE_MS = 30_000;

export type ProfileJobReason = "owner" | "knowledge_change";

/**
 * A claimed job. `attempts` doubles as the claim token: every claim increments it,
 * so after a stale reclaim the earlier worker's writes no longer match the row.
 */
export type ProfileJobClaim = { id: string; assistantId: string; reason: string; attempts: number };

export type ProfileJobSettlement = { status: "completed" | "failed" | "pending"; error: string | null };

const lease = sql`now() - make_interval(mins => ${PROFILE_JOB_LEASE_MINUTES})`;

function ownedBy(claim: ProfileJobClaim) {
  return and(
    eq(assistantProfileJobs.id, claim.id),
    eq(assistantProfileJobs.status, "processing"),
    eq(assistantProfileJobs.attempts, claim.attempts),
  );
}

/** 30s, then 60s, ... before the next attempt. */
export function profileRetryDelayMs(attempts: number): number {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

export async function claimProfileJob(db: Database): Promise<ProfileJobClaim | null> {
  const [claim] = await db
    .update(assistantProfileJobs)
    .set({
      status: "processing",
      lockedAt: sql`now()`,
      attempts: sql`${assistantProfileJobs.attempts} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      eq(
        assistantProfileJobs.id,
        sql`(
          SELECT id FROM assistant_profile_jobs
          WHERE attempts < ${PROFILE_JOB_MAX_ATTEMPTS}
            AND (
              (status = 'pending' AND run_after <= now())
              OR (status = 'processing' AND locked_at < ${lease})
            )
          ORDER BY run_after
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )`,
      ),
    )
    .returning({
      id: assistantProfileJobs.id,
      assistantId: assistantProfileJobs.assistantId,
      reason: assistantProfileJobs.reason,
      attempts: assistantProfileJobs.attempts,
    });
  return claim ?? null;
}

/** A worker that died on its last attempt would otherwise leave the job processing forever. */
export async function failExhaustedProfileJobs(db: Database): Promise<number> {
  const failed = await db
    .update(assistantProfileJobs)
    .set({ status: "failed", error: "attempts_exhausted", lockedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(assistantProfileJobs.status, "processing"),
        gte(assistantProfileJobs.attempts, PROFILE_JOB_MAX_ATTEMPTS),
        lt(assistantProfileJobs.lockedAt, lease),
      ),
    )
    .returning({ assistantId: assistantProfileJobs.assistantId });
  if (failed.length === 0) return 0;
  await db
    .update(assistantProfiles)
    .set({ refreshStatus: "failed", lastError: "attempts_exhausted", updatedAt: new Date() })
    .where(
      and(
        inArray(assistantProfiles.assistantId, [...new Set(failed.map((row) => row.assistantId))]),
        inArray(assistantProfiles.refreshStatus, ["pending", "running"]),
      ),
    );
  return failed.length;
}

/** Extends the lease while the claim is still ours; false means another worker reclaimed the job. */
export async function renewProfileJobClaim(db: Database, claim: ProfileJobClaim): Promise<boolean> {
  const renewed = await db
    .update(assistantProfileJobs)
    .set({ lockedAt: sql`now()`, updatedAt: sql`now()` })
    .where(ownedBy(claim))
    .returning({ id: assistantProfileJobs.id });
  return renewed.length > 0;
}

/** Finishes or reschedules a claimed job; false (and no write) when the claim was lost. */
export async function settleProfileJob(
  db: Database,
  claim: ProfileJobClaim,
  outcome: ProfileJobSettlement,
): Promise<boolean> {
  const retryAt = sql`now() + (${profileRetryDelayMs(claim.attempts)} * interval '1 millisecond')`;
  try {
    const settled = await db
      .update(assistantProfileJobs)
      .set({
        status: outcome.status,
        error: outcome.error,
        lockedAt: null,
        updatedAt: sql`now()`,
        ...(outcome.status === "pending" ? { runAfter: retryAt } : {}),
      })
      .where(ownedBy(claim))
      .returning({ id: assistantProfileJobs.id });
    return settled.length > 0;
  } catch (error) {
    // Only one pending job per assistant: a newer pending job supersedes this retry.
    if (outcome.status !== "pending") throw error;
    const superseded = await db
      .update(assistantProfileJobs)
      .set({ status: "completed", error: "superseded", lockedAt: null, updatedAt: sql`now()` })
      .where(ownedBy(claim))
      .returning({ id: assistantProfileJobs.id });
    return superseded.length > 0;
  }
}

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
