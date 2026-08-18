import type { MessageDebug, MessageOutcome, MessageSource } from "@chatai/database";

import type { EvalCaseSnapshot } from "./eval-snapshot";
import {
  enrichEvalCaseSnapshot,
  hydrateSnapshotFromMetrics,
  readBestStoredSnapshot,
  detectRetrievalInconsistency,
  type EvalHydrationMaps,
} from "./eval-retrieval";

export type EvalScoreRow = {
  id: string;
  caseId?: string | null;
  messageId?: string | null;
  metric: string;
  score: number;
  details?: Record<string, unknown> | null;
  createdAt?: Date | string;
};

export type EvalCaseRow = {
  id: string;
  question: string;
  expectedAnswer?: string | null;
};

export type EvalMessageRow = {
  id: string;
  content: string;
  sources?: MessageSource[] | null;
  outcome?: MessageOutcome | null;
  debug?: MessageDebug | null;
};

export type EvalMetricDetail = {
  metric: string;
  score: number;
  reason?: string;
  details?: Record<string, unknown>;
};

export type EvalCaseDetail = {
  caseId?: string;
  messageId?: string;
  question?: string;
  expectedAnswer?: string | null;
  answer?: string;
  outcome?: string;
  snapshot?: EvalCaseSnapshot;
  retrievalInconsistent?: boolean;
  metrics: EvalMetricDetail[];
};

export type EvalRunDetailsInput = {
  run: {
    id: string;
    assistantId: string;
    evalSetId?: string | null;
    evalSetName?: string | null;
    kind: "online" | "offline";
    status: "pending" | "running" | "completed" | "failed";
    summary?: Record<string, unknown> | null;
    createdAt: Date | string;
    updatedAt?: Date | string;
  };
  scores: EvalScoreRow[];
  cases?: EvalCaseRow[];
  messages?: EvalMessageRow[];
  hydration?: EvalHydrationMaps;
};

export type EvalRunDetails = {
  run: EvalRunDetailsInput["run"];
  cases: EvalCaseDetail[];
};

function isEvalCaseSnapshot(value: unknown): value is EvalCaseSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.question === "string" && typeof record.answer === "string";
}

function readSnapshot(rows: EvalScoreRow[], hydration?: EvalHydrationMaps): EvalCaseSnapshot | undefined {
  const stored = readBestStoredSnapshot(rows, isEvalCaseSnapshot);
  if (!stored) return undefined;
  const enriched = enrichEvalCaseSnapshot(stored);
  return hydrateSnapshotFromMetrics(enriched, rows, hydration);
}

function readMetricReason(details?: Record<string, unknown> | null): string | undefined {
  const reason = details?.reason;
  return typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
}

function stripDetailsForMetric(details?: Record<string, unknown> | null) {
  if (!details) return undefined;
  const { snapshot: _snapshot, reason: _reason, answer: _answer, outcome: _outcome, ...rest } = details;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function groupKey(row: EvalScoreRow) {
  return row.caseId ?? row.messageId ?? "default";
}

function buildLegacySnapshot(opts: {
  question?: string;
  expectedAnswer?: string | null;
  answer?: string;
  outcome?: string;
  message?: EvalMessageRow;
}): EvalCaseSnapshot | undefined {
  const answer = opts.answer ?? opts.message?.content;
  const question =
    opts.question ??
    (typeof opts.message?.debug?.question === "string" ? opts.message.debug.question : undefined);

  if (!answer || !question) {
    return undefined;
  }

  const debug = opts.message?.debug ?? undefined;

  return {
    question,
    ...(opts.expectedAnswer !== undefined ? { expectedAnswer: opts.expectedAnswer } : {}),
    answer,
    ...(opts.outcome ? { outcome: opts.outcome } : {}),
    ...(opts.message?.outcome ? { outcome: opts.message.outcome } : {}),
    context: "",
    sources: opts.message?.sources ?? [],
    retrieval: [],
    citations: [],
    ...(debug ? { debug } : {}),
    ...(typeof debug?.model === "string" ? { model: debug.model } : {}),
  };
}

function enrichLegacySnapshot(snapshot: EvalCaseSnapshot): EvalCaseSnapshot {
  return enrichEvalCaseSnapshot(snapshot);
}

export function buildEvalRunDetails(input: EvalRunDetailsInput): EvalRunDetails {
  const caseById = new Map((input.cases ?? []).map((item) => [item.id, item]));
  const messageById = new Map((input.messages ?? []).map((item) => [item.id, item]));
  const grouped = new Map<string, EvalScoreRow[]>();

  for (const row of input.scores) {
    const key = groupKey(row);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const cases: EvalCaseDetail[] = [...grouped.entries()].map(([_key, rows]) => {
    const caseId = rows[0]?.caseId ?? undefined;
    const messageId = rows[0]?.messageId ?? undefined;
    const evalCase = caseId ? caseById.get(caseId) : undefined;
    const message = messageId ? messageById.get(messageId) : undefined;

    const snapshot =
      readSnapshot(rows, input.hydration) ??
      hydrateSnapshotFromMetrics(
        enrichLegacySnapshot(
          buildLegacySnapshot({
            question: evalCase?.question,
            expectedAnswer: evalCase?.expectedAnswer,
            answer: rows.map((row) => row.details?.answer).find((value) => typeof value === "string") as
              | string
              | undefined,
            outcome: rows.map((row) => row.details?.outcome).find((value) => typeof value === "string") as
              | string
              | undefined,
            message,
          }) ?? {
            question: evalCase?.question ?? "Unknown question",
            answer:
              rows.map((row) => row.details?.answer).find((value) => typeof value === "string") ??
              message?.content ??
              "",
            context: "",
            sources: message?.sources ?? [],
            retrieval: [],
            citations: [],
          },
        ),
        rows,
        input.hydration,
      );

    const metrics = rows
      .map((row) => ({
        metric: row.metric,
        score: row.score,
        ...(readMetricReason(row.details) ? { reason: readMetricReason(row.details) } : {}),
        ...(stripDetailsForMetric(row.details) ? { details: stripDetailsForMetric(row.details) } : {}),
      }))
      .sort((a, b) => a.metric.localeCompare(b.metric));

    return {
      ...(caseId ? { caseId } : {}),
      ...(messageId ? { messageId } : {}),
      question: snapshot?.question ?? evalCase?.question,
      expectedAnswer: snapshot?.expectedAnswer ?? evalCase?.expectedAnswer,
      answer:
        snapshot?.answer ??
        (rows.map((row) => row.details?.answer).find((value) => typeof value === "string") as
          | string
          | undefined),
      outcome:
        snapshot?.outcome ??
        (rows.map((row) => row.details?.outcome).find((value) => typeof value === "string") as
          | string
          | undefined),
      ...(snapshot ? { snapshot } : {}),
      ...(snapshot && detectRetrievalInconsistency(snapshot) ? { retrievalInconsistent: true } : {}),
      metrics,
    };
  });

  cases.sort((a, b) => {
    const left = a.question ?? a.caseId ?? a.messageId ?? "";
    const right = b.question ?? b.caseId ?? b.messageId ?? "";
    return left.localeCompare(right);
  });

  return {
    run: input.run,
    cases,
  };
}
