import Link from "next/link";

import type { Assistant } from "@/lib/assistants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function AssistantCard({ assistant }: { assistant: Assistant }) {
  return (
    <Link href={`/dashboard/assistants/${assistant.id}`} className="block h-full">
      <Card className="h-full transition-colors hover:bg-accent/40">
        <CardHeader>
          <CardTitle className="truncate">{assistant.name}</CardTitle>
          <CardDescription className="font-mono text-xs">{assistant.publicId}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
            {assistant.description || "No description"}
          </p>
          <p className="text-xs text-muted-foreground">Updated {formatDate(assistant.updatedAt)}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
