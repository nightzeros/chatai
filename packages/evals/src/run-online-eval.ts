import {
  evalJobs,
  evalRuns,
  evalScores,
  eq,
  type Database,
  type EvalRunSummary,
} from "@chatai/database";
import type { ChatConfig } from "@chatai/ai";
import type { ProviderUsageRecord } from "@chatai/rag/answer";
import { nanoid } from "nanoid";

import type { ScorerDeps } from "./scorers";
import { loadOnlineEvalContext } from "./load-context";
import { buildEvalCaseSnapshot } from "./eval-snapshot";
import { toEvalDebugRetrieval } from "./eval-retrieval";
import { assertEvalSnapshot, attachEvalScoreDetails } from "./persist-details";
import { scoreMessage, summarizeScores } from "./score-message";

export async function runOnlineEvalJob(opts: {
  db: Database;
  messageId: string;
  chat: ChatConfig;
  deps?: Partial<ScorerDeps>;
}): Promise<{
  runId: string;
  scores: Awaited<ReturnType<typeof scoreMessage>>["scores"];
  providerUsages: ProviderUsageRecord[];
}> {
  const loaded = await loadOnlineEvalContext(opts.db, opts.messageId);
  if (!loaded) {
    throw new Error(`Message ${opts.messageId} is not scoreable.`);
  }

  const runId = nanoid();
  await opts.db.insert(evalRuns).values({
    id: runId,
    assistantId: loaded.assistantId,
    kind: "online",
    status: "running",
  });

  try {
    const snapshot = buildEvalCaseSnapshot({
      question: loaded.context.question,
      answer: loaded.context.answer,
      outcome: loaded.outcome,
      retrieved: loaded.retrieved,
      sources: loaded.context.sources,
      debug: loaded.debug,
      model: opts.chat.model,
      provider: opts.chat.baseURL,
    });

    assertEvalSnapshot(snapshot, loaded.outcome ?? "answered_with_context", loaded.retrieved.length);

    const { scores, providerUsages } = await scoreMessage({
      chat: opts.chat,
      context: {
        ...loaded.context,
        context: snapshot.context,
        retrieval: toEvalDebugRetrieval(loaded.retrieved),
      },
      deps: opts.deps,
    });

    await opts.db.insert(evalScores).values(
      scores.map((score) => ({
        id: nanoid(),
        runId,
        messageId: opts.messageId,
        metric: score.metric,
        score: score.score,
        details: attachEvalScoreDetails({ score, snapshot, contextChunks: loaded.retrieved }),
      })),
    );

    const summary: EvalRunSummary = summarizeScores(scores);
    await opts.db
      .update(evalRuns)
      .set({
        status: "completed",
        summary,
        updatedAt: new Date(),
      })
      .where(eq(evalRuns.id, runId));

    return { runId, scores, providerUsages };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Online eval failed.";
    await opts.db
      .update(evalRuns)
      .set({
        status: "failed",
        summary: { error: message },
        updatedAt: new Date(),
      })
      .where(eq(evalRuns.id, runId));
    throw error;
  }
}

export async function enqueueOnlineEvalJob(opts: { db: Database; messageId: string }) {
  const id = nanoid();
  await opts.db.insert(evalJobs).values({
    id,
    messageId: opts.messageId,
    status: "pending",
    attempts: 0,
  });
  return id;
}

export function shouldSampleEval(sampleRate: number, randomFn: () => number = Math.random) {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  return randomFn() < sampleRate;
}
