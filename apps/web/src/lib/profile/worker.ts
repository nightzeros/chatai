import {
  and,
  assistantProfiles,
  assistants,
  checkDatabaseUrlPair,
  createDb,
  documents,
  eq,
  type Database,
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

import {
  claimProfileJob,
  failExhaustedProfileJobs,
  PROFILE_GENERATION_TIMEOUT_MS,
  PROFILE_JOB_MAX_ATTEMPTS,
  PROFILE_REFRESH_DAILY_CAP,
  renewProfileJobClaim,
  settleProfileJob,
  type ProfileJobClaim,
  type ProfileJobSettlement,
} from "./jobs";

const WORKER_VERSION = "profile-2";
const POLL_MS = 3000;

type GlobalWorker = typeof globalThis & {
  __chataiProfileWorker?: { version: string; stop: () => void };
};

export type ProfileWorkerDeps = {
  generateKeyFactCandidates: typeof generateKeyFactCandidates;
  generationTimeoutMs: number;
};

const defaultDeps: ProfileWorkerDeps = {
  generateKeyFactCandidates,
  generationTimeoutMs: PROFILE_GENERATION_TIMEOUT_MS,
};
let deps = defaultDeps;

export function setProfileWorkerDepsForTests(next: Partial<ProfileWorkerDeps> | null): void {
  deps = next ? { ...defaultDeps, ...next } : defaultDeps;
}

class ProfileGenerationTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProfileGenerationTimeout("profile generation timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

let workerClient: Database | null = null;

function workerDb() {
  if (workerClient) return workerClient;
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the profile worker.");
  const mismatch = checkDatabaseUrlPair(env.DATABASE_URL, env.DATABASE_URL_UNPOOLED);
  if (mismatch) console.error(`[profile-worker] ${mismatch.reason}`);
  workerClient = createDb(url, { max: 1 });
  return workerClient;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function readyDocuments(db: Database, assistantId: string) {
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
async function runFactsJob(db: Database, job: ProfileJobClaim): Promise<string> {
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
    result = await withTimeout(
      deps.generateKeyFactCandidates({
        db,
        assistantId: assistant.id,
        embedding: models.embedding,
        chat: models.chat,
      }),
      deps.generationTimeoutMs,
    );
    usages = result.usages;
  } catch (error) {
    if (usages.length === 0) await abortEvalUsageReservation(reservation).catch(() => undefined);
    reservation = null;
    throw error;
  }
  // A reclaimed job is billed and published only by the worker that now owns it.
  // Renewing the lease also keeps it ours for the few writes below.
  if (!(await renewProfileJobClaim(db, job))) {
    await abortEvalUsageReservation(reservation).catch(() => undefined);
    return "claim_lost";
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

/** Claims and runs at most one job. Returns whether a job was claimed. */
export async function processProfileJobOnce(db: Database): Promise<boolean> {
  await failExhaustedProfileJobs(db);
  const job = await claimProfileJob(db);
  if (!job) return false;
  let settlement: ProfileJobSettlement = { status: "completed", error: null };
  let failed = false;
  try {
    const outcome = await runFactsJob(db, job);
    // Another worker reclaimed the job; it owns the row and the profile status now.
    if (outcome === "claim_lost") return true;
    if (!outcome.startsWith("suggestions")) settlement = { status: "completed", error: outcome };
  } catch (failure) {
    const limit = isUsageLimitExceededError(failure);
    failed = true;
    settlement = {
      status: limit || job.attempts >= PROFILE_JOB_MAX_ATTEMPTS ? "failed" : "pending",
      error: limit ? "usage_limit" : failure instanceof ProfileGenerationTimeout ? "generation_timeout" : "generation_failed",
    };
    console.error(`[profile] job for assistant ${job.assistantId} failed (${settlement.error})`);
  }
  const owned = await settleProfileJob(db, job, settlement).catch((unlockError: unknown) => {
    console.error("[profile] failed to unlock job:", unlockError);
    return false;
  });
  if (owned && failed) {
    await db
      .update(assistantProfiles)
      .set({
        refreshStatus: settlement.status === "failed" ? "failed" : "pending",
        lastError: settlement.error,
        updatedAt: new Date(),
      })
      .where(eq(assistantProfiles.assistantId, job.assistantId))
      .catch(() => undefined);
  }
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
      const processed = await processProfileJobOnce(workerDb());
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
