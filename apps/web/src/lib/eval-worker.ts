import { createDb, assistants, conversations, eq, evalJobs, evalRuns, messages, sql } from "@chatai/database";
import {
  evalWorkerVersionLabel,
  EVAL_WORKER_VERSION,
  maybeFinalizeOfflineRun,
  runOfflineEvalCase,
  runOnlineEvalJob,
} from "@chatai/evals";
import { resolveRagSettings } from "@chatai/rag/answer";

import { resolveAssistantModels } from "@/lib/ai-config";
import { env } from "@/lib/env";
import {
  checkHostingAccountAccess,
  resolveBillableAccountForAssistant,
} from "@/lib/hosting/accounts";
import {
  abortEvalUsageReservation,
  beginEvalUsageReservation,
  finishEvalUsageReservation,
  type UsageGateReservation,
} from "@/lib/hosting/usage-gate";
import { isUsageLimitExceededError, UsageLimitExceededError } from "@/lib/hosting/usage-limit-error";
import { createId } from "@/lib/ids";

const POLL_MS = 2000;
const MAX_ATTEMPTS = 3;

type GlobalWorker = typeof globalThis & {
  __chataiEvalWorker?: {
    version: string;
    stop: () => void;
  };
};

type ClaimedEvalJob = {
  id: string;
  messageId: string | null;
  runId: string | null;
  caseId: string | null;
  attempts: number;
};

let workerClient: ReturnType<typeof createDb> | null = null;

function workerDb() {
  if (workerClient) return workerClient;
  const url = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required for the eval worker.");
  }
  workerClient = createDb(url, { max: 1 });
  return workerClient;
}

async function claimJob(db: ReturnType<typeof createDb>) {
  const result = await db.execute(sql`
    UPDATE eval_jobs
    SET
      status = 'processing',
      locked_at = now(),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id
      FROM eval_jobs
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
      message_id AS "messageId",
      run_id AS "runId",
      case_id AS "caseId",
      attempts
  `);

  const rows = result as unknown as ClaimedEvalJob[];
  return rows[0] ?? null;
}

async function assistantForMessage(db: ReturnType<typeof createDb>, messageId: string) {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) {
    throw new Error(`Message ${messageId} was not found.`);
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId))
    .limit(1);
  if (!conversation) {
    throw new Error(`Conversation ${message.conversationId} was not found.`);
  }

  const [assistant] = await db
    .select()
    .from(assistants)
    .where(eq(assistants.id, conversation.assistantId))
    .limit(1);
  if (!assistant) {
    throw new Error(`Assistant ${conversation.assistantId} was not found.`);
  }

  return assistant;
}

async function assistantForRun(db: ReturnType<typeof createDb>, runId: string) {
  const [run] = await db.select().from(evalRuns).where(eq(evalRuns.id, runId)).limit(1);
  if (!run) {
    throw new Error(`Eval run ${runId} was not found.`);
  }

  const [assistant] = await db
    .select()
    .from(assistants)
    .where(eq(assistants.id, run.assistantId))
    .limit(1);
  if (!assistant) {
    throw new Error(`Assistant ${run.assistantId} was not found.`);
  }

  return assistant;
}

async function processOnce() {
  const db = workerDb();
  const job = await claimJob(db);
  if (!job) return false;

  const hold = { reservation: null as UsageGateReservation | null };
  let assistantId: string | null = null;
  let accountId: string | null = null;
  const requestId = createId();

  try {
    if (job.messageId) {
      const assistant = await assistantForMessage(db, job.messageId);
      assistantId = assistant.id;
      const models = await resolveAssistantModels(assistant);
      const account = await resolveBillableAccountForAssistant(assistant);
      accountId = account.id;
      const access = checkHostingAccountAccess(account);
      if (!access.ok) {
        throw new UsageLimitExceededError(access.error);
      }

      hold.reservation = await beginEvalUsageReservation({
        account,
        assistantId: assistant.id,
        requestId,
        kind: "online",
        chat: models.chat,
        embedding: models.embedding,
        billing: models.billing,
        message: "",
      });

      const result = await runOnlineEvalJob({
        db,
        messageId: job.messageId,
        chat: models.chat,
      });

      await finishEvalUsageReservation({
        reservation: hold.reservation,
        accountId: account.id,
        assistantId: assistant.id,
        requestId,
        records: result.providerUsages,
        billing: models.billing,
      });
      hold.reservation = null;
    } else if (job.runId && job.caseId) {
      console.log(`[eval] offline case ${job.caseId} using ${evalWorkerVersionLabel()}`);
      const assistant = await assistantForRun(db, job.runId);
      assistantId = assistant.id;
      const models = await resolveAssistantModels(assistant);
      const account = await resolveBillableAccountForAssistant(assistant);
      accountId = account.id;
      const access = checkHostingAccountAccess(account);
      if (!access.ok) {
        throw new UsageLimitExceededError(access.error);
      }

      const rag = resolveRagSettings(assistant.ragSettings);
      hold.reservation = await beginEvalUsageReservation({
        account,
        assistantId: assistant.id,
        requestId,
        kind: "offline",
        chat: models.chat,
        embedding: models.embedding,
        billing: models.billing,
        message: `eval-case:${job.caseId}`,
        queryExpansionEnabled: rag.queryExpansion,
        rerankEnabled: rag.rerank,
        verifyCitationsEnabled: rag.guardrails.verifyCitations,
        hasCohereKey: Boolean(env.COHERE_API_KEY),
      });

      const result = await runOfflineEvalCase({
        db,
        runId: job.runId,
        caseId: job.caseId,
        chat: models.chat,
        embedding: models.embedding,
        cohereApiKey: env.COHERE_API_KEY ?? null,
      });

      await finishEvalUsageReservation({
        reservation: hold.reservation,
        accountId: account.id,
        assistantId: assistant.id,
        requestId,
        records: result.providerUsages,
        billing: models.billing,
      });
      hold.reservation = null;
    } else {
      throw new Error("Eval jobs require a messageId or a runId and caseId.");
    }

    await db
      .update(evalJobs)
      .set({
        status: "completed",
        error: null,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(evalJobs.id, job.id));

    if (job.runId) {
      await maybeFinalizeOfflineRun({ db, runId: job.runId });
    }
  } catch (error) {
    await abortEvalUsageReservation(hold.reservation);
    hold.reservation = null;

    const message = error instanceof Error ? error.message : "Eval job failed.";
    const limitExceeded = isUsageLimitExceededError(error);
    const terminal = limitExceeded || job.attempts >= MAX_ATTEMPTS;

    await db
      .update(evalJobs)
      .set({
        status: terminal ? "failed" : "pending",
        error: message,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(evalJobs.id, job.id));

    if (terminal && job.runId) {
      await maybeFinalizeOfflineRun({ db, runId: job.runId });
    }

    const target = job.messageId
      ? `message ${job.messageId}`
      : `run ${job.runId} case ${job.caseId}`;
    console.error(
      `[eval] ${target} failed${accountId ? ` (account ${accountId})` : ""}${
        assistantId ? ` assistant ${assistantId}` : ""
      }:`,
      message,
    );
  }

  return true;
}

export function startEvalWorker() {
  const g = globalThis as GlobalWorker;
  if (g.__chataiEvalWorker?.version === EVAL_WORKER_VERSION) return;
  if (!env.DATABASE_URL) {
    console.warn("[eval] worker not started: DATABASE_URL is missing");
    return;
  }
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  if (g.__chataiEvalWorker) {
    g.__chataiEvalWorker.stop();
  }

  let stopped = false;
  g.__chataiEvalWorker = {
    version: EVAL_WORKER_VERSION,
    stop: () => {
      stopped = true;
    },
  };

  console.log(`[eval] worker started (${evalWorkerVersionLabel()})`);

  const tick = async () => {
    if (stopped) return;
    try {
      const processed = await processOnce();
      setTimeout(tick, processed ? 50 : POLL_MS);
    } catch (error) {
      console.error("[eval] worker tick failed:", error);
      setTimeout(tick, POLL_MS);
    }
  };

  void tick();
}
