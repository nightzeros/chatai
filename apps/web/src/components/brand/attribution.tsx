import type { CSSProperties } from "react";

import { brand } from "@/lib/site";
import { cn } from "@/lib/utils";

export function BrandAttribution({
  variant = "inline",
  className,
  style,
}: {
  variant?: "inline" | "stacked";
  className?: string;
  style?: CSSProperties;
}) {
  const link = (
    <a
      href={brand.company.url}
      target="_blank"
      rel="noreferrer"
      className="text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
    >
      {brand.company.name}
    </a>
  );

  if (variant === "stacked") {
    return (
      <p className={cn("text-xs text-muted-foreground", className)} style={style}>
        A {link} project
      </p>
    );
  }

  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      by {link}
    </span>
  );
}
