import type { EvalCaseDetail, EvalMetricDetail, EvalRunDetails } from "@chatai/evals";

export type EvalRunSummaryRow = {
  status: "pending" | "running" | "completed" | "failed";
  summary?: {
    averages?: Record<string, number>;
    error?: string;
  } | null;
};

const METRIC_LABELS: Record<string, string> = {
  faithfulness: "Faithfulness",
  contextRelevance: "Context relevance",
  answerRelevance: "Answer relevance",
  citationCorrectness: "Citation correctness",
};

const LOW_SCORE_THRESHOLD = 0.7;

export function formatMetricScore(score: number) {
  return score.toFixed(2);
}

export function formatMetricLabel(metric: string) {
  return METRIC_LABELS[metric] ?? metric;
}

export function isLowScore(score: number) {
  return score < LOW_SCORE_THRESHOLD;
}

export function formatDebugSectionTitle(key: string) {
  if (key === "expansion") return "Query expansion";
  if (key === "rerank") return "Reranking";
  if (key === "hybrid") return "Hybrid retrieval";
  if (key === "verifier") return "Answer verifier";
  return key;
}

export function caseLabel(item: EvalCaseDetail, index: number) {
  if (item.question) {
    return item.question.length > 96 ? `${item.question.slice(0, 96)}…` : item.question;
  }
  if (item.caseId) return `Case ${item.caseId.slice(0, 8)}`;
  if (item.messageId) return `Message ${item.messageId.slice(0, 8)}`;
  return `Result ${index + 1}`;
}

export function caseHasLowScores(item: EvalCaseDetail) {
  return item.metrics.some((metric) => isLowScore(metric.score));
}

export function runHasLowScores(run: EvalRunSummaryRow) {
  const averages = run.summary?.averages;
  if (!averages) return false;
  return Object.values(averages).some((score) => isLowScore(score));
}

export function runNeedsAttention(run: EvalRunSummaryRow) {
  return run.status === "failed" || runHasLowScores(run);
}

export function hasRetrievalDebug(details: EvalRunDetails["cases"][number]["snapshot"]) {
  if (!details?.debug) return false;
  return Boolean(
    details.debug.expansion ||
      details.debug.rerank ||
      details.debug.hybrid ||
      details.debug.verifier ||
      details.debug.hybridSearch !== undefined,
  );
}

export function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function hasUsefulRawDetails(details?: Record<string, unknown>) {
  if (!details) return false;
  const keys = Object.keys(details).filter((key) => key !== "judge" && key !== "reason");
  return keys.length > 0;
}

export function formatCitationExplanation(details?: Record<string, unknown>) {
  if (!details) return undefined;

  if (details.note === "no_inline_citations") {
    return details.citations && Array.isArray(details.citations) && details.citations.length === 0
      ? "The answer contains no inline [n] citations."
      : "No inline citations were detected in the answer.";
  }

  if (Array.isArray(details.invalid) && details.invalid.length > 0) {
    const invalid = details.invalid.join(", ");
    const maxIndex = typeof details.maxIndex === "number" ? details.maxIndex : "?";
    return `Invalid citation markers [${invalid}]. Only ${maxIndex} chunk(s) were available to cite.`;
  }

  if (Array.isArray(details.citations) && details.citations.length > 0) {
    const matched = typeof details.matched === "number" ? details.matched : undefined;
    const citedDocuments = Array.isArray(details.citedDocuments) ? details.citedDocuments.length : undefined;
    if (matched !== undefined && citedDocuments !== undefined) {
      return `${matched} of ${citedDocuments} cited source(s) matched documents attached to the answer.`;
    }
    return `Citations used: [${details.citations.join("], [")}].`;
  }

  return undefined;
}

export function formatMetricExplanation(metric: EvalMetricDetail) {
  if (metric.reason) return metric.reason;

  if (metric.metric === "citationCorrectness") {
    return formatCitationExplanation(metric.details);
  }

  if (metric.details?.judge === "llm") {
    return "No judge explanation was recorded for this run. Re-run the eval to capture reasoning.";
  }

  return undefined;
}

export function formatExpansionDebug(expansion: unknown) {
  if (!expansion || typeof expansion !== "object") return undefined;
  const record = expansion as Record<string, unknown>;
  const queries = Array.isArray(record.queries) ? record.queries.filter((item) => typeof item === "string") : [];
  if (queries.length === 0) return undefined;
  return `Expanded into ${queries.length} quer${queries.length === 1 ? "y" : "ies"}: ${queries.join(" · ")}`;
}

export function formatRerankDebug(rerank: unknown) {
  if (!rerank || typeof rerank !== "object") return undefined;
  const record = rerank as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? record.provider : "unknown";
  const order = Array.isArray(record.order) ? record.order : [];
  if (order.length === 0) {
    return `Reranking enabled (${provider}), but no reorder metadata was stored.`;
  }
  return `Reranked ${order.length} chunk(s) using ${provider}.`;
}

export function formatExpectedAnswer(value?: string | null, isOfflineCase?: boolean) {
  if (value && value.trim()) return value.trim();
  if (isOfflineCase) return "Not provided";
  return undefined;
}

export function lowestMetric(item: EvalCaseDetail) {
  if (item.metrics.length === 0) return undefined;
  return [...item.metrics].sort((a, b) => a.score - b.score)[0];
}
