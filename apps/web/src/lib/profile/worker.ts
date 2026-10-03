import {
  and,
  assistantProfileJobs,
  assistantProfiles,
  assistants,
  checkDatabaseUrlPair,
  createDb,
  documents,
  eq,
  sql,
  type KeyFact,
} from "@chatai/database";
import {
  activeFacts,
  generateKeyFactCandidates,
  invalidateAssistantContext,
  knowledgeFingerprint,
  mergeFactSuggestions,
  type ProviderUsageRecord,
} from "@chatai/rag/answer";

import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { resolveAssistantModels } from "@/lib/ai-config";
import { env } from "@/lib/env";
import { checkHostingAccountAccess, resolveBillableAccountForAssistant } from "@/lib/hosting/accounts";
import {
  abortEvalUsageReservation,
  beginProfileUsageReservation,
  finishProfileUsageReservation,
  type UsageGateReservation,
} from "@/lib/hosting/usage-gate";
import { isUsageLimitExceededError, UsageLimitExceededError } from "@/lib/hosting/usage-limit-error";
import { createId } from "@/lib/ids";

import { PROFILE_REFRESH_DAILY_CAP } from "./jobs";

const WORKER_VERSION = "profile-1";
const POLL_MS = 3000;
const MAX_ATTEMPTS = 3;

type GlobalWorker = typeof globalThis & {
  __chataiProfileWorker?: { version: string; stop: () => void };
};

type ClaimedJob = { id: string; assistantId: string; reason: string; attempts: number };

let workerClient: ReturnType<typeof createDb> | null = null;

function workerDb() {
  if (workerClient) return workerClient;
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the profile worker.");
  const mismatch = checkDatabaseUrlPair(env.DATABASE_URL, env.DATABASE_URL_UNPOOLED);
  if (mismatch) console.error(`[profile-worker] ${mismatch.reason}`);
  workerClient = createDb(url, { max: 1 });
  return workerClient;
}

async function claimJob(db: ReturnType<typeof createDb>): Promise<ClaimedJob | null> {
  const rows = (await db.execute(sql`
    UPDATE assistant_profile_jobs
    SET status = 'processing', locked_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM assistant_profile_jobs
      WHERE attempts < ${MAX_ATTEMPTS}
        AND (
          (status = 'pending' AND run_after <= now())
          OR (status = 'processing' AND locked_at < now() - interval '5 minutes')
        )
      ORDER BY run_after
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, assistant_id AS "assistantId", reason, attempts
  `)) as unknown as ClaimedJob[];
  return rows[0] ?? null;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function readyDocuments(db: ReturnType<typeof createDb>, assistantId: string) {
  return db
    .select({
      id: documents.id,
      name: documents.name,
      status: documents.status,
      excluded: documents.excluded,
      contentHash: documents.contentHash,
    })
    .from(documents)
    .where(eq(documents.assistantId, assistantId));
}

/** Returns a short sanitized status for logs; never document text. */
async function runFactsJob(db: ReturnType<typeof createDb>, job: ClaimedJob): Promise<string> {
  const [assistant] = await db.select().from(assistants).where(eq(assistants.id, job.assistantId)).limit(1);
  if (!assistant) return "assistant_missing";

  await db.insert(assistantProfiles).values({ assistantId: assistant.id }).onConflictDoNothing();
  const [profile] = await db
    .select()
    .from(assistantProfiles)
    .where(eq(assistantProfiles.assistantId, assistant.id))
    .limit(1);
  if (!profile) return "profile_missing";

  const today = utcDay();
  const refreshesToday = profile.refreshDay === today ? profile.refreshesToday : 0;
  if (job.reason !== "owner" && refreshesToday >= PROFILE_REFRESH_DAILY_CAP) return "daily_cap";

  const docs = await readyDocuments(db, assistant.id);
  const usable = docs.filter((doc) => doc.status === "ready" && !doc.excluded);
  const fingerprint = knowledgeFingerprint(usable);
  if (job.reason !== "owner" && fingerprint === profile.knowledgeFingerprint) return "unchanged";

  await db
    .update(assistantProfiles)
    .set({ refreshStatus: "running", updatedAt: new Date() })
    .where(eq(assistantProfiles.assistantId, assistant.id));

  const models = await resolveAssistantModels(assistant);
  const account = await resolveBillableAccountForAssistant(assistant);
  const access = checkHostingAccountAccess(account);
  if (!access.ok) throw new UsageLimitExceededError(access.error);
  const requestId = createId();
  let reservation: UsageGateReservation | null = await beginProfileUsageReservation({
    account,
    assistantId: assistant.id,
    requestId,
    chat: models.chat,
    embedding: models.embedding,
    billing: models.billing,
  });

  let usages: ProviderUsageRecord[] = [];
  let result;
  try {
    result = await generateKeyFactCandidates({
      db,
      assistantId: assistant.id,
      embedding: models.embedding,
      chat: models.chat,
    });
    usages = result.usages;
  } catch (error) {
    if (usages.length === 0) await abortEvalUsageReservation(reservation).catch(() => undefined);
    reservation = null;
    throw error;
  }
  await finishProfileUsageReservation({
    reservation,
    accountId: account.id,
    assistantId: assistant.id,
    requestId,
    records: usages,
    billing: models.billing,
  });

  const docMap = new Map(docs.map((doc) => [doc.id, doc]));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [current] = await db
      .select()
      .from(assistantProfiles)
      .where(eq(assistantProfiles.assistantId, assistant.id))
      .limit(1);
    if (!current) return "profile_missing";
    const published: KeyFact[] = current.facts ?? [];
    const activeIds = new Set(activeFacts(published, docMap).map((fact) => fact.id));
    const suggestions = mergeFactSuggestions({
      published,
      activeIds,
      dismissed: current.dismissed ?? [],
      candidates: result.facts,
      now: new Date().toISOString(),
      newId: createId,
    });
    const updated = await db
      .update(assistantProfiles)
      .set({
        suggestions,
        conflicts: result.conflicts,
        refreshStatus: "idle",
        lastError: null,
        refreshedAt: new Date(),
        knowledgeFingerprint: fingerprint,
        refreshDay: today,
        refreshesToday: (current.refreshDay === today ? current.refreshesToday : 0) + (job.reason === "owner" ? 0 : 1),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(assistantProfiles.assistantId, assistant.id), eq(assistantProfiles.version, current.version)))
      .returning({ version: assistantProfiles.version });
    if (updated.length > 0) {
      invalidateAssistantContext(assistant.id);
      await logAuditEvent({
        userId: assistant.userId,
        action: "assistant_profile_refreshed",
        resourceType: "assistant",
        resourceId: assistant.id,
        metadata: {
          reason: job.reason,
          suggestions: suggestions.length,
          rejected: result.rejected,
          conflicts: result.conflicts.length,
        },
      });
      return `suggestions:${suggestions.length}`;
    }
  }
  await db
    .update(assistantProfiles)
    .set({ refreshStatus: "idle", updatedAt: new Date() })
    .where(eq(assistantProfiles.assistantId, assistant.id));
  return "version_conflict";
}

async function processOnce(): Promise<boolean> {
  const db = workerDb();
  const job = await claimJob(db);
  if (!job) return false;
  let status: "completed" | "pending" | "failed" = "completed";
  let error: string | null = null;
  try {
    const outcome = await runFactsJob(db, job);
    if (outcome !== "completed" && !outcome.startsWith("suggestions")) error = outcome;
  } catch (failure) {
    const limit = isUsageLimitExceededError(failure);
    status = limit || job.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
    error = limit ? "usage_limit" : "generation_failed";
    console.error(`[profile] job for assistant ${job.assistantId} failed (${error})`);
    await db
      .update(assistantProfiles)
      .set({ refreshStatus: status === "failed" ? "failed" : "pending", lastError: error, updatedAt: new Date() })
      .where(eq(assistantProfiles.assistantId, job.assistantId))
      .catch(() => undefined);
  }
  await db
    .update(assistantProfileJobs)
    .set({ status, error, lockedAt: null, updatedAt: new Date() })
    .where(eq(assistantProfileJobs.id, job.id))
    .catch(async (unlockError: unknown) => {
      // Only one pending job per assistant: a newer pending job supersedes this retry.
      if (status !== "pending") throw unlockError;
      await db
        .update(assistantProfileJobs)
        .set({ status: "completed", error: "superseded", lockedAt: null, updatedAt: new Date() })
        .where(eq(assistantProfileJobs.id, job.id));
    })
    .catch((unlockError: unknown) => console.error("[profile] failed to unlock job:", unlockError));
  return true;
}

export function startProfileWorker(): void {
  const g = globalThis as GlobalWorker;
  if (g.__chataiProfileWorker?.version === WORKER_VERSION) return;
  if (!env.DATABASE_URL) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  g.__chataiProfileWorker?.stop();

  let stopped = false;
  g.__chataiProfileWorker = {
    version: WORKER_VERSION,
    stop: () => {
      stopped = true;
    },
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const processed = await processOnce();
      setTimeout(tick, processed ? 50 : POLL_MS);
    } catch (error) {
      // Missing table before migration 0020 lands here; keep polling slowly.
      const message = error instanceof Error ? error.message : String(error);
      if (!/assistant_profile_jobs/.test(message)) console.error("[profile] worker tick failed:", message);
      setTimeout(tick, POLL_MS * 10);
    }
  };
  void tick();
}
