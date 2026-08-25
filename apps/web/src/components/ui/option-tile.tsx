"use client";

import { cn } from "@/lib/utils";

export function OptionTile({
  selected,
  title,
  description,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  selected?: boolean;
  title: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-foreground bg-accent/60"
          : "border-border bg-card hover:bg-accent/40",
        className,
      )}
      aria-pressed={selected}
      {...props}
    >
      <div className="text-sm font-medium">{title}</div>
      {description ? <div className="mt-0.5 text-xs text-muted-foreground">{description}</div> : null}
    </button>
  );
}
