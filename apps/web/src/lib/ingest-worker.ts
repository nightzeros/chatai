import {
  assistants,
  checkDatabaseUrlPair,
  createDb,
  documents,
  eq,
  ingestJobs,
  sources,
  sql,
} from "@chatai/database";

import { ingestDocument, syncSource } from "@chatai/rag";

import { resolveAssistantModels } from "@/lib/ai-config";
import { env } from "@/lib/env";
import { resolveBillableAccountForAssistant, checkHostingAccountAccess } from "@/lib/hosting/accounts";
import {
  abortIngestUsageReservation,
  beginIngestUsageReservation,
  finishIngestUsageReservation,
  type UsageGateReservation,
} from "@/lib/hosting/usage-gate";
import { isUsageLimitExceededError, UsageLimitExceededError } from "@/lib/hosting/usage-limit-error";
import { createId } from "@/lib/ids";
import { onKnowledgeChanged } from "@/lib/profile/jobs";

const POLL_MS = 2000;
const MAX_ATTEMPTS = 3;

type GlobalWorker = typeof globalThis & { __chataiIngestWorker?: boolean };

type ClaimedJob = {
  id: string;
  kind: "ingest" | "sync";
  documentId: string | null;
  sourceId: string | null;
  attempts: number;
};

let workerClient: ReturnType<typeof createDb> | null = null;

function workerDb() {
  if (workerClient) return workerClient;
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for the ingest worker.");
  }
  const mismatch = checkDatabaseUrlPair(env.DATABASE_URL, env.DATABASE_URL_UNPOOLED);
  if (mismatch) {
    console.error(`[ingest-worker] ${mismatch.reason} Ingestion will not reach the app's database.`);
  }
  workerClient = createDb(url, { max: 1 });
  return workerClient;
}

async function embeddingForDocument(db: ReturnType<typeof createDb>, documentId: string) {
  const [row] = await db
    .select({ assistant: assistants })
    .from(documents)
    .innerJoin(assistants, eq(assistants.id, documents.assistantId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!row) {
    throw new Error(`Document ${documentId} was not found.`);
  }

  const models = await resolveAssistantModels(row.assistant);
  return { assistant: row.assistant, embedding: models.embedding, billing: models.billing };
}

async function claimJob(db: ReturnType<typeof createDb>) {
  const result = await db.execute(sql`
    UPDATE ingest_jobs
    SET
      status = 'processing',
      locked_at = now(),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id
      FROM ingest_jobs
      WHERE
        attempts < ${MAX_ATTEMPTS}
        AND (
          status = 'pending'
          OR (status = 'processing' AND locked_at < now() - interval '2 minutes')
        )
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      kind,
      document_id AS "documentId",
      source_id AS "sourceId",
      attempts
  `);

  const rows = result as unknown as ClaimedJob[];
  return rows[0] ?? null;
}

async function failDocument(db: ReturnType<typeof createDb>, documentId: string, message: string) {
  await db
    .update(documents)
    .set({ status: "failed", error: message, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

async function processOnce() {
  const db = workerDb();
  const job = await claimJob(db);
  if (!job) return false;

  const hold = { reservation: null as UsageGateReservation | null };

  try {
    if (job.kind === "sync") {
      if (!job.sourceId) {
        throw new Error("Sync jobs require a sourceId.");
      }
      await syncSource({ sourceId: job.sourceId, db });
    } else {
      if (!job.documentId) {
        throw new Error("Ingest jobs require a documentId.");
      }
      const resolved = await embeddingForDocument(db, job.documentId);
      const account = await resolveBillableAccountForAssistant(resolved.assistant);
      const access = checkHostingAccountAccess(account);
      if (!access.ok) {
        throw new UsageLimitExceededError(access.error);
      }
      const requestId = createId();

      const result = await ingestDocument({
        documentId: job.documentId,
        db,
        embedding: resolved.embedding,
        beforeEmbed: async ({ approxTokens }) => {
          hold.reservation = await beginIngestUsageReservation({
            account,
            assistantId: resolved.assistant.id,
            requestId,
            embedding: resolved.embedding,
            billingMode: resolved.billing.embedding,
            approxTokens,
          });
        },
      });

      if (!result.skipped) {
        await finishIngestUsageReservation({
          reservation: hold.reservation,
          accountId: account.id,
          assistantId: resolved.assistant.id,
          requestId,
          embedding: resolved.embedding,
          billingMode: resolved.billing.embedding,
          usage: result.embeddingUsage ?? null,
        });
        hold.reservation = null;
      }
    }

    await db
      .update(ingestJobs)
      .set({
        status: "completed",
        error: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.id, job.id));
  } catch (error) {
    await abortIngestUsageReservation(hold.reservation);

    const usageBlocked = isUsageLimitExceededError(error);
    const message = usageBlocked
      ? error.message
      : error instanceof Error
        ? error.message
        : "Ingestion failed.";
    const terminal = usageBlocked || job.attempts >= MAX_ATTEMPTS;

    await db
      .update(ingestJobs)
      .set({
        status: terminal ? "failed" : "pending",
        error: message,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(ingestJobs.id, job.id));

    if (job.kind === "ingest" && job.documentId) {
      await failDocument(db, job.documentId, message);
    }

    const target = job.kind === "sync" ? `source ${job.sourceId}` : `document ${job.documentId}`;
    console.error(`[ingest] ${target} failed:`, message);
  }

  await notifyKnowledgeChanged(db, job);
  return true;
}

/** Debounced Key-facts refresh for assistants with published facts; never throws. */
async function notifyKnowledgeChanged(
  db: ReturnType<typeof createDb>,
  job: { kind: string; documentId: string | null; sourceId: string | null },
): Promise<void> {
  try {
    const [row] = job.documentId
      ? await db
          .select({ assistantId: documents.assistantId })
          .from(documents)
          .where(eq(documents.id, job.documentId))
          .limit(1)
      : job.sourceId
        ? await db.select({ assistantId: sources.assistantId }).from(sources).where(eq(sources.id, job.sourceId)).limit(1)
        : [];
    if (row) await onKnowledgeChanged(db, row.assistantId);
  } catch {
    // Profile refresh is best-effort.
  }
}

export function startIngestWorker() {
  const g = globalThis as GlobalWorker;
  if (g.__chataiIngestWorker) return;
  if (!env.DATABASE_URL) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  g.__chataiIngestWorker = true;

  const tick = async () => {
    try {
      const processed = await processOnce();
      setTimeout(tick, processed ? 50 : POLL_MS);
    } catch (error) {
      console.error("[ingest] worker tick failed:", error);
      setTimeout(tick, POLL_MS);
    }
  };

  void tick();
}
