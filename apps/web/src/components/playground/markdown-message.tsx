import type { Components } from "react-markdown";
import Markdown from "react-markdown";

import { cn } from "@/lib/utils";

const components: Components = {
  a: ({ href, children }) => {
    const safe = href?.startsWith("http://") || href?.startsWith("https://") || href?.startsWith("mailto:");
    if (!safe || !href) {
      return <span>{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    );
  },
  code: ({ className, children }) => {
    const inline = !className;
    if (inline) {
      return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
    }
    return <code className={cn("font-mono text-[0.85em]", className)}>{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-sm">{children}</pre>
  ),
};

export function MarkdownMessage({
  content,
  streaming,
  className,
}: {
  content: string;
  streaming?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
    >
      {content ? <Markdown components={components}>{content}</Markdown> : null}
      {streaming ? (
        <span
          className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-px animate-pulse bg-foreground align-middle"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
