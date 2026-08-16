import type { MessageSource } from "@chatai/database";

export function SourcesBlock({ sources }: { sources: MessageSource[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {sources.map((source, index) => (
          <li key={`${source.documentId}:${source.chunkId ?? index}`} className="text-sm">
            <span className="font-medium">{source.documentName}</span>
            {source.page != null ? (
              <span className="text-muted-foreground"> · p.{source.page}</span>
            ) : null}
            {source.excerpt ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{source.excerpt}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
