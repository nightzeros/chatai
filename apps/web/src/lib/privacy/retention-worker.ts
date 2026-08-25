import { assistants, sql } from "@chatai/database";

import { PrivacyPolicy } from "../policies/privacy-policy";

export type RetentionWorkerDeps = {
  listAssistants: () => Promise<
    Array<{
      id: string;
      privacySettings?: Parameters<typeof PrivacyPolicy.fromAssistant>[0]["privacySettings"];
    }>
  >;
  deleteExpiredConversations: (assistantId: string, cutoff: Date) => Promise<number>;
  anonymizeVisitors: (assistantId: string, cutoff: Date) => Promise<number>;
  now?: Date;
  log?: (message: string, meta?: Record<string, unknown>) => void;
};

/**
 * Per-assistant retention + anonymization using PrivacyPolicy cutoffs.
 * Cascades: deleting a conversation removes messages (FK ON DELETE CASCADE);
 * eval_jobs for those messages cascade; eval_results.message_id is set null.
 */
export async function runRetentionPass(deps: RetentionWorkerDeps): Promise<{
  purged: number;
  anonymized: number;
  assistantsProcessed: number;
  failures: number;
}> {
  const now = deps.now ?? new Date();
  const log = deps.log ?? ((message, meta) => console.log(`[privacy] ${message}`, meta ?? ""));
  const rows = await deps.listAssistants();

  let purged = 0;
  let anonymized = 0;
  let failures = 0;

  for (const assistant of rows) {
    try {
      const policy = PrivacyPolicy.fromAssistant(assistant);
      const cutoff = policy.retentionCutoff(now);
      if (cutoff) {
        purged += await deps.deleteExpiredConversations(assistant.id, cutoff);
      }

      const anonCutoff = policy.anonymizeCutoff(now);
      if (anonCutoff) {
        anonymized += await deps.anonymizeVisitors(assistant.id, anonCutoff);
      }
    } catch (error) {
      failures += 1;
      log("assistant privacy pass failed", {
        assistantId: assistant.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { purged, anonymized, assistantsProcessed: rows.length, failures };
}

export async function defaultListAssistants() {
  const { db } = await import("@/lib/db");
  return db()
    .select({
      id: assistants.id,
      privacySettings: assistants.privacySettings,
    })
    .from(assistants);
}

export async function defaultDeleteExpiredConversations(assistantId: string, cutoff: Date) {
  const { db } = await import("@/lib/db");
  const deleted = await db().execute<{ id: string }>(sql`
    DELETE FROM conversations
    WHERE assistant_id = ${assistantId}
      AND updated_at < ${cutoff.toISOString()}
    RETURNING id
  `);
  return deleted.length;
}

/**
 * Clear visitorId on conversations older than cutoff that still have a visitorId.
 * Idempotent: already-null / empty visitorIds are skipped.
 * Does not invent reversible tokens — null removes the association.
 */
export async function defaultAnonymizeVisitors(assistantId: string, cutoff: Date) {
  const { db } = await import("@/lib/db");
  const updated = await db().execute<{ id: string }>(sql`
    UPDATE conversations
    SET visitor_id = NULL
    WHERE assistant_id = ${assistantId}
      AND updated_at < ${cutoff.toISOString()}
      AND visitor_id IS NOT NULL
      AND visitor_id <> ''
    RETURNING id
  `);
  return updated.length;
}

const POLL_MS = 60_000;
type GlobalPrivacy = typeof globalThis & { __chataiPrivacyWorker?: boolean };

export function startPrivacyWorker() {
  const g = globalThis as GlobalPrivacy;
  if (g.__chataiPrivacyWorker) return;
  g.__chataiPrivacyWorker = true;

  const tick = async () => {
    try {
      await runRetentionPass({
        listAssistants: defaultListAssistants,
        deleteExpiredConversations: defaultDeleteExpiredConversations,
        anonymizeVisitors: defaultAnonymizeVisitors,
      });
    } catch (error) {
      console.error("[privacy] worker tick failed:", error instanceof Error ? error.message : error);
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_MS);
}
