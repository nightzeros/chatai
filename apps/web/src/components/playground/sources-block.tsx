import type { MessageSource } from "@chatai/database";

export function SourcesBlock({ sources }: { sources: MessageSource[] }) {
  if (sources.length === 0) return null;

  return (
    <details open className="group mt-3 border-t border-border pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
          ▸
        </span>
        Sources ({sources.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {sources.map((source, index) => (
          <li key={`${source.documentId}:${source.chunkId ?? index}`} className="text-sm">
            <span className="font-medium">{source.documentName}</span>
            {source.page != null ? <span className="text-muted-foreground"> · p.{source.page}</span> : null}
            {source.excerpt ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{source.excerpt}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
