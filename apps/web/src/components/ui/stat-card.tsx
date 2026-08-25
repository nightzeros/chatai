import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  className,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const valueClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning-foreground"
        : tone === "danger"
          ? "text-destructive"
          : tone === "info"
            ? "text-info"
            : "text-foreground";

  return (
    <Card className={cn("shadow-none", className)}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-2xl font-semibold tabular-nums", valueClass)}>{value}</CardTitle>
      </CardHeader>
      {hint ? <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent> : null}
    </Card>
  );
}
