import Link from "next/link";

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
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="truncate text-base">{assistant.name}</CardTitle>
            {signing ? <Badge variant="info">Signed</Badge> : null}
          </div>
          <CardDescription className="font-mono text-xs">{assistant.publicId}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {assistant.description || "No description"}
          </p>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>
              {knowledgeTotal} knowledge
              {stats && stats.knowledgeFailed > 0 ? ` · ${stats.knowledgeFailed} failed` : ""}
            </span>
            <span>·</span>
            <span>{stats?.conversationCount ?? 0} conversations</span>
          </div>
          <p className="text-xs text-muted-foreground">Updated {formatDate(assistant.updatedAt)}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
