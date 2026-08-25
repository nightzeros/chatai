import Link from "next/link";
import { Bot } from "lucide-react";

import type { Assistant } from "@/lib/assistants";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function AssistantCard({
  assistant,
  stats,
}: {
  assistant: Assistant;
  stats?: {
    knowledgeReady: number;
    knowledgeProcessing: number;
    knowledgeFailed: number;
    conversationCount: number;
  };
}) {
  const signing = Boolean(assistant.securitySettings?.requireWidgetSigning);
  const knowledgeTotal =
    (stats?.knowledgeReady ?? 0) + (stats?.knowledgeProcessing ?? 0) + (stats?.knowledgeFailed ?? 0);

  return (
    <Link href={`/dashboard/assistants/${assistant.id}`} className="block h-full">
      <Card className="h-full shadow-none transition-colors hover:bg-accent/40">
        <CardHeader className="space-y-2 p-5">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate font-display text-base font-semibold tracking-tight">
              {assistant.name}
            </CardTitle>
            {signing ? <Badge variant="info">Signed</Badge> : null}
          </div>
          <CardDescription className="font-mono text-xs">{assistant.publicId}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 p-5 pt-0">
          {assistant.description ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">{assistant.description}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>
              {knowledgeTotal} knowledge
              {stats && stats.knowledgeFailed > 0 ? ` · ${stats.knowledgeFailed} failed` : ""}
            </span>
            <span aria-hidden>·</span>
            <span>{stats?.conversationCount ?? 0} conversations</span>
          </div>
          <p className="text-xs text-muted-foreground">Updated {formatDate(assistant.updatedAt)}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function AssistantsEmptyIcon() {
  return <Bot className="size-8" aria-hidden />;
}
