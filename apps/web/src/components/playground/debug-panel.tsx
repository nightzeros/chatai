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
  const expansion =
    debug.expansion && typeof debug.expansion === "object"
      ? (debug.expansion as { enabled?: boolean; expanded?: boolean; queries?: string[]; alternates?: string[] })
      : null;
  const rerank =
    debug.rerank && typeof debug.rerank === "object"
      ? (debug.rerank as { enabled?: boolean; provider?: string })
      : null;
  const hybrid = Array.isArray(debug.hybrid)
    ? debug.hybrid.filter(
        (item): item is { chunkId: string; vectorRank?: number; keywordRank?: number; rrfScore?: number } =>
          typeof item === "object" && item !== null && "chunkId" in item,
      )
    : [];
  const verifier =
    debug.verifier && typeof debug.verifier === "object"
      ? (debug.verifier as { passed?: boolean; reason?: string; regenerated?: boolean; enabled?: boolean })
      : null;
  const scope =
    debug.scope && typeof debug.scope === "object"
      ? (debug.scope as {
          decision?: string;
          socialProtocol?: boolean;
          vagueHelp?: boolean;
          classifierFallback?: boolean;
          injectionSuspected?: boolean;
          redirectSource?: string;
          purposeSource?: string;
          profileVersion?: number;
          profileRoute?: string;
          plannerMs?: number;
          plannerWaitMs?: number;
          outputGuard?: {
            reasons?: string[];
            method?: string;
            passed?: boolean;
            replaced?: boolean;
            unavailable?: boolean;
            checkMs?: number;
          };
        })
      : null;
  const outputGuard =
    debug.outputGuard && typeof debug.outputGuard === "object"
      ? (debug.outputGuard as {
          reasons?: string[];
          method?: string;
          passed?: boolean;
          replaced?: boolean;
          unavailable?: boolean;
          checkMs?: number;
        })
      : (scope?.outputGuard ?? null);
  const scopeFlags = scope
    ? [
        scope.socialProtocol ? "social" : null,
        scope.vagueHelp ? "vague help" : null,
        scope.classifierFallback ? "classifier fallback" : null,
        scope.injectionSuspected ? "injection signal" : null,
      ].filter(Boolean)
    : [];

  return (
    <details className="group mt-3 border-t border-border pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1 font-medium uppercase tracking-wide">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
            ▸
          </span>
          Inspect
        </span>
        <span className="flex min-w-0 items-center gap-2 font-mono normal-case tracking-normal">
          <OutcomeBadge outcome={outcome} />
          <span>{formatScore(confidence)}</span>
          <span>{formatMs(debug.latencyMs)}</span>
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-4 font-mono text-xs">
        <p className="font-sans text-xs text-muted-foreground normal-case tracking-normal">
          Retrieval decision, scores, and pipeline detail for this answer. Collapsed by default.
        </p>
        {failed ? (
          <section className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-destructive">
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

        {scope ? (
          <section>
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Scope
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Decision</dt>
              <dd>{scope.decision ?? "—"}</dd>
              <dt className="text-muted-foreground">Purpose source</dt>
              <dd>{scope.purposeSource ?? "—"}</dd>
              {scopeFlags.length > 0 ? (
                <>
                  <dt className="text-muted-foreground">Flags</dt>
                  <dd>{scopeFlags.join(" · ")}</dd>
                </>
              ) : null}
              {scope.redirectSource ? (
                <>
                  <dt className="text-muted-foreground">Redirect</dt>
                  <dd>{scope.redirectSource}</dd>
                </>
              ) : null}
              {scope.profileRoute ? (
                <>
                  <dt className="text-muted-foreground">Profile route</dt>
                  <dd>{scope.profileRoute}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Classifier</dt>
              <dd>
                {formatMs(scope.plannerMs)}
                {typeof scope.plannerWaitMs === "number" ? ` · wait ${scope.plannerWaitMs}ms` : ""}
              </dd>
              {typeof scope.profileVersion === "number" ? (
                <>
                  <dt className="text-muted-foreground">Profile version</dt>
                  <dd>{scope.profileVersion}</dd>
                </>
              ) : null}
            </dl>
          </section>
        ) : null}

        {outputGuard ? (
          <section>
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Output check
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Reasons</dt>
              <dd>{outputGuard.reasons?.join(" · ") || "—"}</dd>
              <dt className="text-muted-foreground">Result</dt>
              <dd>
                {outputGuard.replaced ? "replaced" : outputGuard.passed ? "pass" : "fail"}
                {outputGuard.unavailable ? " · check unavailable" : ""}
              </dd>
            </dl>
          </section>
        ) : null}

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

        {expansion ? (
          <section>
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Expansion
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Enabled</dt>
              <dd>{expansion.enabled ? "yes" : "no"}</dd>
              <dt className="text-muted-foreground">Expanded</dt>
              <dd>{expansion.expanded ? "yes" : "no"}</dd>
              <dt className="text-muted-foreground">Queries</dt>
              <dd>{expansion.queries?.join(" · ") || "—"}</dd>
            </dl>
          </section>
        ) : null}

        {rerank ? (
          <section>
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Rerank
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Enabled</dt>
              <dd>{rerank.enabled ? "yes" : "no"}</dd>
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{rerank.provider ?? "—"}</dd>
            </dl>
          </section>
        ) : null}

        {hybrid.length > 0 ? (
          <section>
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Hybrid ranks
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {hybrid.map((item) => (
                <li key={item.chunkId}>
                  {item.chunkId} · v{item.vectorRank ?? "—"} · k{item.keywordRank ?? "—"} · rrf{" "}
                  {typeof item.rrfScore === "number" ? item.rrfScore.toFixed(4) : "—"}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {verifier ? (
          <section>
            <p className="font-sans text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Verifier
            </p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Verdict</dt>
              <dd>{verifier.passed ? "pass" : "fail"}</dd>
              <dt className="text-muted-foreground">Regenerated</dt>
              <dd>{verifier.regenerated ? "yes" : "no"}</dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{verifier.reason ?? "—"}</dd>
            </dl>
          </section>
        ) : null}

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
