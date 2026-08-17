import type { MessageDebug, MessageOutcome } from "@chatai/database";

import { OutcomeBadge } from "@/components/chat/outcome-badge";

function formatMs(value: unknown) {
  return typeof value === "number" ? `${value}ms` : "—";
}

function formatScore(value: number | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(3);
}

export function DebugPanel({
  outcome,
  confidence,
  debug,
}: {
  outcome: MessageOutcome;
  confidence: number;
  debug: MessageDebug;
}) {
  const retrieval = debug.retrieval ?? [];
  const decision = debug.decision;
  const failed =
    outcome === "retrieval_failure" ||
    outcome === "model_failure" ||
    outcome === "fallback_no_context" ||
    decision?.action === "fallback";
  const retrievalError = typeof debug.retrievalError === "string" ? debug.retrievalError : null;
  const modelError = typeof debug.error === "string" ? debug.error : null;
  const sourcesUsed = Array.isArray(debug.sourcesUsed)
    ? debug.sourcesUsed.filter((item): item is string => typeof item === "string")
    : [];

  return (
    <details className="group mt-3 border-t border-border pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1 font-medium uppercase tracking-wide">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
            ▸
          </span>
          Debug
        </span>
        <span className="flex min-w-0 items-center gap-2 font-mono normal-case tracking-normal">
          <OutcomeBadge outcome={outcome} />
          <span>{formatScore(confidence)}</span>
          <span>{formatMs(debug.latencyMs)}</span>
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-4 font-mono text-xs">
        {failed ? (
          <section className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Failure
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Best score</dt>
              <dd>{formatScore(decision?.bestScore ?? retrieval[0]?.similarity)}</dd>
              <dt className="text-muted-foreground">Decision</dt>
              <dd>{decision?.action ?? "—"}</dd>
              <dt className="text-muted-foreground">Context</dt>
              <dd>{decision ? (decision.contextSufficient ? "sufficient" : "insufficient") : "—"}</dd>
            </dl>
            {retrievalError ? <p className="mt-2 text-destructive">{retrievalError}</p> : null}
            {modelError ? <p className="mt-2 text-destructive">{modelError}</p> : null}
          </section>
        ) : null}

        <section>
          <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Decision
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Context sufficient</dt>
            <dd>{decision ? (decision.contextSufficient ? "yes" : "no") : "—"}</dd>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd>{decision?.confidence ?? "—"}</dd>
            <dt className="text-muted-foreground">Mode</dt>
            <dd>{decision?.mode ?? "—"}</dd>
            <dt className="text-muted-foreground">Action</dt>
            <dd>{decision?.action ?? "—"}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd>{debug.model ?? "—"}</dd>
            <dt className="text-muted-foreground">Latency</dt>
            <dd>
              {formatMs(debug.latencyMs)}
              {typeof debug.retrieveMs === "number" ? ` · retrieve ${debug.retrieveMs}ms` : ""}
            </dd>
          </dl>
        </section>

        <section>
          <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Retrieval
          </p>
          {retrieval.length === 0 ? (
            <p className="mt-2 text-muted-foreground">No chunks retrieved.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {retrieval.map((chunk, index) => (
                <li key={chunk.chunkId}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      [{index + 1}] {chunk.documentName}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatScore(chunk.similarity)}</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground/70"
                      style={{ width: `${Math.max(2, Math.min(100, chunk.similarity * 100))}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Sources used
          </p>
          {sourcesUsed.length === 0 ? (
            <p className="mt-2 text-muted-foreground">None.</p>
          ) : (
            <ul className="mt-2 list-disc pl-4">
              {sourcesUsed.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}
