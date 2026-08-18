"use client";

import { ChevronDown, ChevronRight } from "lucide-react";

import {
  caseHasLowScores,
  caseLabel,
  formatDebugSectionTitle,
  formatExpansionDebug,
  formatExpectedAnswer,
  formatMetricExplanation,
  formatMetricLabel,
  formatMetricScore,
  formatRerankDebug,
  hasRetrievalDebug,
  hasUsefulRawDetails,
  isLowScore,
  lowestMetric,
  safeJson,
} from "@/lib/eval-run-details-format";
import type { EvalCaseDetail, EvalMetricDetail, EvalRunDetails } from "@chatai/evals";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function TextBlock({
  label,
  value,
  muted = false,
}: {
  label: string;
  value?: string | null;
  muted?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="grid gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`whitespace-pre-wrap rounded-md border border-border px-3 py-2 text-sm ${
          muted ? "bg-muted/20 text-muted-foreground italic" : "bg-muted/30"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function RawJsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <details className="rounded-md border border-border bg-muted/10">
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">{label}</summary>
      <pre className="overflow-x-auto border-t border-border px-3 py-2 text-xs">{safeJson(value)}</pre>
    </details>
  );
}

function MetricScoreCard({ metric }: { metric: EvalMetricDetail }) {
  const explanation = formatMetricExplanation(metric);
  const low = isLowScore(metric.score);

  return (
    <li
      className={`rounded-md border px-3 py-3 ${
        low ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-background"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{formatMetricLabel(metric.metric)}</p>
        <p className={`text-sm tabular-nums ${low ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}>
          {formatMetricScore(metric.score)}
        </p>
      </div>
      {explanation ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground">{explanation}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No explanation available.</p>
      )}
      {hasUsefulRawDetails(metric.details) ? (
        <div className="mt-2">
          <RawJsonDetails label="Raw metric debug" value={metric.details} />
        </div>
      ) : null}
    </li>
  );
}

function RetrievedChunks({
  snapshot,
}: {
  snapshot: NonNullable<EvalCaseDetail["snapshot"]>;
}) {
  const retrieval = snapshot.retrieval ?? [];
  const hasContextFallback = retrieval.length === 0 && Boolean(snapshot.context?.trim());

  if (retrieval.length === 0 && !hasContextFallback) {
    return (
      <p className="text-sm text-muted-foreground">
        No retrieved context was stored for this run. Re-run the eval to capture chunk-level debug data.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {retrieval.map((chunk) => {
        const cited = snapshot.citations.some((citation) => citation.marker === chunk.index);
        return (
          <li key={chunk.chunkId} className="rounded-md border border-border px-3 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                <span className="mr-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">[{chunk.index}]</span>
                {chunk.documentName}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {cited ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">Cited in answer</span> : null}
                <span className="tabular-nums">similarity {chunk.similarity.toFixed(3)}</span>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              doc {chunk.documentId}
              {chunk.chunkId ? ` · chunk ${chunk.chunkId.slice(0, 8)}` : ""}
              {chunk.page !== undefined ? ` · page ${chunk.page}` : ""}
            </p>
            {chunk.url ? (
              <a
                href={chunk.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-xs text-primary hover:underline"
              >
                {chunk.url}
              </a>
            ) : null}
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {(chunk.parentContent ?? chunk.content) || "Chunk content was not stored for this run."}
            </p>
          </li>
        );
      })}
      {retrieval.length === 0 && hasContextFallback ? (
        <li className="rounded-md border border-border px-3 py-3">
          <p className="text-xs text-muted-foreground">
            Reconstructed from the final context block sent to the answer model:
          </p>
          <pre className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{snapshot.context}</pre>
        </li>
      ) : null}
    </ul>
  );
}

function CaseDetails({ item, index }: { item: EvalCaseDetail; index: number }) {
  const snapshot = item.snapshot;
  const isOfflineCase = Boolean(item.caseId);
  const expectedAnswer = formatExpectedAnswer(item.expectedAnswer ?? snapshot?.expectedAnswer, isOfflineCase);
  const weakest = lowestMetric(item);
  const openByDefault = caseHasLowScores(item);

  return (
    <details className="rounded-lg border border-border bg-background" open={openByDefault}>
      <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{caseLabel(item, index)}</p>
          {weakest && isLowScore(weakest.score) ? (
            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              Low {formatMetricLabel(weakest.metric)} ({formatMetricScore(weakest.score)})
            </span>
          ) : null}
        </div>
      </summary>

      <div className="flex flex-col gap-5 border-t border-border px-4 py-4">
        <TextBlock label="Question" value={item.question ?? snapshot?.question} />
        {isOfflineCase ? <TextBlock label="Expected answer (rubric)" value={expectedAnswer} muted={!expectedAnswer || expectedAnswer === "Not provided"} /> : null}
        {!isOfflineCase && expectedAnswer ? (
          <TextBlock label="Expected answer (rubric)" value={expectedAnswer} />
        ) : null}

        {item.retrievalInconsistent ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            Retrieval metadata is inconsistent: the answer cites sources and was marked answered_with_context, but
            retrieved chunks could not be reconstructed. Restart the dev server and re-run the eval to capture a fresh
            snapshot.
          </p>
        ) : null}

        <Section title="Retrieved context">
          {snapshot ? <RetrievedChunks snapshot={snapshot} /> : (
            <p className="text-sm text-muted-foreground">
              Retrieved context was not stored for this run. Re-run the eval to capture chunk-level debug data.
            </p>
          )}
        </Section>

        <TextBlock label="Generated answer" value={item.answer ?? snapshot?.answer} />

        {snapshot?.citations && snapshot.citations.length > 0 ? (
          <Section title="Citations in answer">
            <ul className="rounded-md border border-border text-sm">
              {snapshot.citations.map((citation) => (
                <li key={citation.marker} className="border-t border-border px-3 py-2 first:border-t-0">
                  <span className="font-mono text-xs">[{citation.marker}]</span>
                  {" → "}
                  {citation.documentName ?? "unknown source"}
                  {citation.url ? (
                    <>
                      {" · "}
                      <a href={citation.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        source
                      </a>
                    </>
                  ) : null}
                  {citation.chunkId ? ` · chunk ${citation.chunkId.slice(0, 8)}` : ""}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Judge scores">
          <ul className="flex flex-col gap-2">
            {item.metrics.map((metric) => (
              <MetricScoreCard key={metric.metric} metric={metric} />
            ))}
          </ul>
        </Section>

        {item.outcome || snapshot?.outcome ? (
          <p className="text-xs text-muted-foreground">Outcome: {item.outcome ?? snapshot?.outcome}</p>
        ) : null}

        {snapshot?.context ? (
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
              Final context sent to answer model
            </summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-3 text-xs leading-relaxed">
              {snapshot.context}
            </pre>
          </details>
        ) : null}

        {hasRetrievalDebug(snapshot) ? (
          <Section title="Retrieval debug">
            <div className="grid gap-3">
              {snapshot?.debug?.question ? (
                <TextBlock label="Rewritten query" value={String(snapshot.debug.question)} />
              ) : null}
              {snapshot?.debug?.expansion ? (
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">{formatDebugSectionTitle("expansion")}</p>
                  <p className="text-sm">{formatExpansionDebug(snapshot.debug.expansion) ?? "Query expansion ran."}</p>
                  <RawJsonDetails label="Raw expansion debug" value={snapshot.debug.expansion} />
                </div>
              ) : null}
              {snapshot?.debug?.rerank ? (
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">{formatDebugSectionTitle("rerank")}</p>
                  <p className="text-sm">{formatRerankDebug(snapshot.debug.rerank) ?? "Reranking ran."}</p>
                  <RawJsonDetails label="Raw rerank debug" value={snapshot.debug.rerank} />
                </div>
              ) : null}
              {snapshot?.debug?.hybrid ? (
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">{formatDebugSectionTitle("hybrid")}</p>
                  <RawJsonDetails label="Raw hybrid debug" value={snapshot.debug.hybrid} />
                </div>
              ) : null}
              {snapshot?.debug?.verifier ? (
                <div className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">{formatDebugSectionTitle("verifier")}</p>
                  {typeof snapshot.debug.verifier === "object" &&
                  snapshot.debug.verifier !== null &&
                  "reason" in snapshot.debug.verifier &&
                  typeof (snapshot.debug.verifier as { reason?: unknown }).reason === "string" ? (
                    <p className="text-sm">{(snapshot.debug.verifier as { reason: string }).reason}</p>
                  ) : null}
                  <RawJsonDetails label="Raw verifier debug" value={snapshot.debug.verifier} />
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {!snapshot && !item.question && item.metrics.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Detailed snapshot metadata was not stored for this run. Metric scores are still available above.
          </p>
        ) : null}
      </div>
    </details>
  );
}

export function EvalRunDetailsView({ details }: { details: EvalRunDetails }) {
  const { run } = details;
  const model = details.cases[0]?.snapshot?.model;
  const provider = details.cases[0]?.snapshot?.provider;
  const runError = typeof run.summary?.error === "string" ? run.summary.error : undefined;

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="mb-4 grid gap-1 text-sm">
        <p>
          <span className="font-medium">Type:</span> {run.kind}
        </p>
        <p>
          <span className="font-medium">Status:</span> {run.status}
        </p>
        <p>
          <span className="font-medium">Started:</span> {new Date(run.createdAt).toLocaleString()}
        </p>
        {run.evalSetName ? (
          <p>
            <span className="font-medium">Test set:</span> {run.evalSetName}
          </p>
        ) : null}
        {model ? (
          <p>
            <span className="font-medium">Model:</span> {model}
          </p>
        ) : null}
        {provider ? (
          <p>
            <span className="font-medium">Provider:</span> {provider}
          </p>
        ) : null}
        {runError ? (
          <p className="text-destructive">
            <span className="font-medium">Error:</span> {runError}
          </p>
        ) : null}
      </div>

      {details.cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {run.status === "pending" || run.status === "running"
            ? "This eval is still running. Refresh in a moment to inspect case-level results."
            : runError
              ? "No scored cases were recorded for this run."
              : "No scored cases yet."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {details.cases.map((item, index) => (
            <CaseDetails key={item.caseId ?? item.messageId ?? String(index)} item={item} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EvalRunRowChevron({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
  );
}
