import {
  and,
  asc,
  desc,
  eq,
  evalCases,
  evalRuns,
  evalSets,
  inArray,
} from "@chatai/database";
import { assertReadyToRun, enqueueOfflineEvalRun } from "@chatai/evals";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import { startEvalWorker } from "@/lib/eval-worker";
import { createId } from "@/lib/ids";

export type EvalSet = typeof evalSets.$inferSelect;
export type EvalCase = typeof evalCases.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;

export { parseEvalCaseInput, parseEvalSetName } from "@/lib/eval-sets-parse";

export async function listEvalSetsForAssistant(assistantId: string) {
  const sets = await db()
    .select()
    .from(evalSets)
    .where(eq(evalSets.assistantId, assistantId))
    .orderBy(desc(evalSets.updatedAt));

  const setIds = sets.map((set) => set.id);
  const cases =
    setIds.length === 0
      ? []
      : await db().select().from(evalCases).where(inArray(evalCases.evalSetId, setIds)).orderBy(asc(evalCases.createdAt));

  return sets.map((set) => ({
    ...set,
    cases: cases.filter((item) => item.evalSetId === set.id),
  }));
}

export async function getOwnedEvalSet(userId: string, assistantId: string, setId: string) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const [set] = await db()
    .select()
    .from(evalSets)
    .where(and(eq(evalSets.id, setId), eq(evalSets.assistantId, assistantId)))
    .limit(1);

  return set ?? null;
}

export async function createEvalSet(assistantId: string, name: string) {
  const id = createId();
  await db().insert(evalSets).values({
    id,
    assistantId,
    name,
  });

  const [set] = await db().select().from(evalSets).where(eq(evalSets.id, id)).limit(1);
  return set!;
}

export async function updateEvalSet(setId: string, name: string) {
  await db()
    .update(evalSets)
    .set({ name, updatedAt: new Date() })
    .where(eq(evalSets.id, setId));
}

export async function deleteEvalSet(setId: string) {
  await db().delete(evalSets).where(eq(evalSets.id, setId));
}

export async function listCasesForSet(setId: string) {
  return db().select().from(evalCases).where(eq(evalCases.evalSetId, setId)).orderBy(asc(evalCases.createdAt));
}

export async function createEvalCase(setId: string, input: { question: string; expectedAnswer: string | null }) {
  const id = createId();
  await db().insert(evalCases).values({
    id,
    evalSetId: setId,
    question: input.question,
    expectedAnswer: input.expectedAnswer,
  });
  await db().update(evalSets).set({ updatedAt: new Date() }).where(eq(evalSets.id, setId));

  const [row] = await db().select().from(evalCases).where(eq(evalCases.id, id)).limit(1);
  return row!;
}

export async function getOwnedEvalCase(
  userId: string,
  assistantId: string,
  setId: string,
  caseId: string,
) {
  const set = await getOwnedEvalSet(userId, assistantId, setId);
  if (!set) return null;

  const [row] = await db()
    .select()
    .from(evalCases)
    .where(and(eq(evalCases.id, caseId), eq(evalCases.evalSetId, setId)))
    .limit(1);

  return row ?? null;
}

export async function updateEvalCase(
  caseId: string,
  setId: string,
  input: { question: string; expectedAnswer: string | null },
) {
  await db()
    .update(evalCases)
    .set({
      question: input.question,
      expectedAnswer: input.expectedAnswer,
      updatedAt: new Date(),
    })
    .where(eq(evalCases.id, caseId));
  await db().update(evalSets).set({ updatedAt: new Date() }).where(eq(evalSets.id, setId));
}

export async function deleteEvalCase(caseId: string, setId: string) {
  await db().delete(evalCases).where(eq(evalCases.id, caseId));
  await db().update(evalSets).set({ updatedAt: new Date() }).where(eq(evalSets.id, setId));
}

export async function listEvalRunsForAssistant(assistantId: string) {
  startEvalWorker();
  return db()
    .select()
    .from(evalRuns)
    .where(eq(evalRuns.assistantId, assistantId))
    .orderBy(desc(evalRuns.createdAt))
    .limit(50);
}

export async function startOfflineEvalRun(assistantId: string, evalSetId: string) {
  const cases = await listCasesForSet(evalSetId);
  const caseIds = cases.map((item) => item.id);
  assertReadyToRun(caseIds);
  const runId = await enqueueOfflineEvalRun({
    db: db(),
    assistantId,
    evalSetId,
    caseIds,
  });
  startEvalWorker();
  return runId;
}
