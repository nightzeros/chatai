import type { AuditEventRow } from "@/lib/audit/list-audit-events";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatWhen(date: Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatAction(action: string) {
  return action.replaceAll("_", " ");
}

type Props = {
  events: AuditEventRow[];
};

export function AuditLogPanel({ events }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>
          Recent security-relevant account activity. Events are append-only and do not store IP
          addresses or secrets.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No audit events yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {events.map((event) => (
              <li key={event.id} className="flex flex-col gap-1 px-3 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium capitalize">{formatAction(event.action)}</p>
                  <p className="text-xs text-muted-foreground">
                    {[event.resourceType, event.resourceId].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {Object.keys(event.metadata).length > 0 ? (
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(event.metadata)}
                    </p>
                  ) : null}
                </div>
                <time
                  className="shrink-0 text-xs text-muted-foreground"
                  dateTime={event.createdAt.toISOString()}
                >
                  {formatWhen(event.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
