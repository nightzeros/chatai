import { generateChat, type ChatConfig, type EmbeddingConfig } from "@chatai/ai";
import {
  assistants,
  evalCases,
  evalJobs,
  evalRuns,
  evalScores,
  eq,
  type Database,
  type EvalRunSummary,
} from "@chatai/database";
import {
  finalizeAnswer,
  generateVerifiedAnswer,
  prepareAnswer,
  resolveRagSettings,
  withVerifierResult,
} from "@chatai/rag/answer";
import { nanoid } from "nanoid";

import { aggregateRunSummary, scoreMessage } from "./score-message";
import { buildEvalCaseSnapshot } from "./eval-snapshot";
import { contextChunksForEval, toEvalDebugRetrieval } from "./eval-retrieval";
import { assertEvalSnapshot, attachEvalScoreDetails } from "./persist-details";
import type { ScorerDeps } from "./scorers";

export type OfflineEvalDeps = Partial<ScorerDeps> & {
  prepareAnswer?: typeof prepareAnswer;
};

export async function runOfflineEvalCase(opts: {
  db: Database;
  runId: string;
  caseId: string;
  chat: ChatConfig;
  embedding: EmbeddingConfig;
  cohereApiKey?: string | null;
  deps?: OfflineEvalDeps;
}) {
  const [evalCase] = await opts.db.select().from(evalCases).where(eq(evalCases.id, opts.caseId)).limit(1);
  if (!evalCase) {
    throw new Error(`Eval case ${opts.caseId} was not found.`);
  }

  const [run] = await opts.db.select().from(evalRuns).where(eq(evalRuns.id, opts.runId)).limit(1);
  if (!run) {
    throw new Error(`Eval run ${opts.runId} was not found.`);
  }

  const [assistant] = await opts.db
    .select()
    .from(assistants)
    .where(eq(assistants.id, run.assistantId))
    .limit(1);
  if (!assistant) {
    throw new Error(`Assistant ${run.assistantId} was not found.`);
  }

  const prepare = opts.deps?.prepareAnswer ?? prepareAnswer;
  const generate = opts.deps?.generateChat ?? generateChat;
  const rag = resolveRagSettings(assistant.ragSettings);

  let prepared = await prepare({
    db: opts.db,
    assistantId: assistant.id,
    instructions: assistant.instructions,
    mode: assistant.hallucinationMode,
    message: evalCase.question,
    embedding: opts.embedding,
    chat: opts.chat,
    ragSettings: assistant.ragSettings,
    cohereApiKey: opts.cohereApiKey,
  });

  let fullText = prepared.fallbackText;
  if (prepared.shouldGenerate && rag.guardrails.verifyCitations) {
    const verified = await generateVerifiedAnswer({
      prepared,
      question: evalCase.question,
      chat: opts.chat,
      deps: opts.deps,
    });
    prepared = withVerifierResult(prepared, verified);
    fullText = verified.text;
  } else if (prepared.shouldGenerate) {
    fullText = await generate({
      config: opts.chat,
      system: prepared.system,
      prompt: evalCase.question,
    });
  }

  const final = finalizeAnswer(fullText, prepared);
  const contextChunks = contextChunksForEval(prepared.retrieved);
  const snapshot = buildEvalCaseSnapshot({
    question: evalCase.question,
    expectedAnswer: evalCase.expectedAnswer,
    answer: final.answer,
    outcome: final.outcome,
    retrieved: contextChunks,
    sources: final.sources,
    debug: final.debug,
    model: opts.chat.model,
    provider: opts.chat.baseURL,
  });

  assertEvalSnapshot(snapshot, final.outcome, contextChunks.length);

  const scores = await scoreMessage({
    chat: opts.chat,
    context: {
      question: evalCase.question,
      answer: final.answer,
      context: snapshot.context,
      sources: final.sources,
      retrieval: toEvalDebugRetrieval(contextChunks),
      ...(evalCase.expectedAnswer ? { expectedAnswer: evalCase.expectedAnswer } : {}),
    },
    deps: opts.deps,
  });

  await opts.db.insert(evalScores).values(
    scores.map((score) => ({
      id: nanoid(),
      runId: opts.runId,
      caseId: opts.caseId,
      metric: score.metric,
      score: score.score,
      details: attachEvalScoreDetails({ score, snapshot, contextChunks }),
    })),
  );

  return { scores, answer: final.answer, outcome: final.outcome };
}

export async function maybeFinalizeOfflineRun(opts: { db: Database; runId: string }) {
  const jobs = await opts.db.select().from(evalJobs).where(eq(evalJobs.runId, opts.runId));
  const incomplete = jobs.filter((job) => job.status === "pending" || job.status === "processing");
  if (incomplete.length > 0) {
    return null;
  }

  const scoreRows = await opts.db.select().from(evalScores).where(eq(evalScores.runId, opts.runId));
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const summary: EvalRunSummary = {
    ...aggregateRunSummary(
      scoreRows.map((row) => ({ metric: row.metric, score: row.score, caseId: row.caseId })),
      jobs.length,
    ),
    ...(failedJobs.length > 0
      ? { error: `${failedJobs.length} of ${jobs.length} cases failed.` }
      : {}),
  };

  await opts.db
    .update(evalRuns)
    .set({
      status: failedJobs.length > 0 && scoreRows.length === 0 ? "failed" : "completed",
      summary,
      updatedAt: new Date(),
    })
    .where(eq(evalRuns.id, opts.runId));

  return summary;
}

export async function enqueueOfflineEvalRun(opts: {
  db: Database;
  assistantId: string;
  evalSetId: string;
  caseIds: string[];
}) {
  const runId = nanoid();
  await opts.db.insert(evalRuns).values({
    id: runId,
    assistantId: opts.assistantId,
    evalSetId: opts.evalSetId,
    kind: "offline",
    status: "running",
  });

  await opts.db.insert(evalJobs).values(
    opts.caseIds.map((caseId) => ({
      id: nanoid(),
      runId,
      caseId,
      status: "pending" as const,
      attempts: 0,
    })),
  );

  return runId;
}

export function assertReadyToRun(caseIds: string[]) {
  if (caseIds.length === 0) {
    throw new Error("Add at least one question before running a regression.");
  }
}
