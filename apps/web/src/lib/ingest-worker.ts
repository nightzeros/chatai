import { createDb, assistants, documents, eq, ingestJobs, sql } from "@chatai/database";

import { ingestDocument, syncSource } from "@chatai/rag";

import { resolveAssistantModels } from "@/lib/ai-config";
import { env } from "@/lib/env";

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
  workerClient = createDb(url, { max: 1 });
  return workerClient;
}

async function embeddingForAssistant(assistant: typeof assistants.$inferSelect) {
  return (await resolveAssistantModels(assistant)).embedding;
}

async function embeddingForDocument(db: ReturnType<typeof createDb>, documentId: string) {
  const [row] = await db
    .select({ assistant: assistants })
    .from(documents)
    .innerJoin(assistants, eq(assistants.id, documents.assistantId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!row) {
    throw new Error(`Document ${documentId} not found.`);
  }

  return await embeddingForAssistant(row.assistant);
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
      await ingestDocument({
        documentId: job.documentId,
        db,
        embedding: await embeddingForDocument(db, job.documentId),

      });
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
    const message = error instanceof Error ? error.message : "Ingestion failed.";
    const terminal = job.attempts >= MAX_ATTEMPTS;

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

  return true;
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
