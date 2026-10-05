import type { VoiceTurnDetails } from "@/lib/conversation-timeline";

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-muted-foreground sm:w-36">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Owner-only summary of how a Voice answer was produced. */
export function VoiceTurnDetailsPanel({
  details,
  sourceCount,
}: {
  details: VoiceTurnDetails;
  sourceCount: number;
}) {
  if (!details.answeredBy) return null;
  const knowledge = details.answeredBy === "knowledge";

  return (
    <details className="group mt-3 border-t border-border pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        Lookup details
      </summary>
      <dl className="mt-2 flex flex-col gap-1.5 text-xs">
        <Row label="Answered using">
          {knowledge ? "ChatAI Knowledge" : "Voice model (no knowledge lookup)"}
        </Row>
        {details.searchQuery ? <Row label="Knowledge search">“{details.searchQuery}”</Row> : null}
        {details.matchedDocuments.length > 0 ? (
          <Row label="Matched documents">{details.matchedDocuments.join(", ")}</Row>
        ) : null}
        {knowledge ? <Row label="Sources cited">{sourceCount}</Row> : null}
        {details.lookupMs !== null ? <Row label="Knowledge lookup">{formatMs(details.lookupMs)}</Row> : null}
        {details.answerReadyMs !== null ? (
          <Row label="Answer ready after">{formatMs(details.answerReadyMs)}</Row>
        ) : null}
        {details.interrupted ? <Row label="Interrupted">The visitor spoke over this answer.</Row> : null}
      </dl>
    </details>
  );
}
