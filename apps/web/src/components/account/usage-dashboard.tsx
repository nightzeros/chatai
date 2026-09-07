import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  formatPlanCode,
  formatUsageDate,
  formatUsageDay,
  formatUsdFromMicros,
  usageBarTone,
} from "@/lib/hosting/format-usage";
import type {
  UsageByAssistantRow,
  UsageByModelRow,
  UsageLimits,
  UsageRecentEvent,
  UsageSummary,
} from "@/lib/hosting/usage-reports";
import { cn } from "@/lib/utils";

function UsageMeter({ percent, tone }: { percent: number; tone: ReturnType<typeof usageBarTone> }) {
  const width = Math.min(100, Math.max(0, percent));
  const barClass =
    tone === "danger"
      ? "bg-destructive"
      : tone === "warning"
        ? "bg-warning"
        : "bg-primary";

  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(width)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Usage of period limit"
    >
      <div className={cn("h-full rounded-full transition-[width]", barClass)} style={{ width: `${width}%` }} />
    </div>
  );
}

function statusBadge(status: UsageSummary["status"]) {
  if (status === "active") return <Badge variant="success">Active</Badge>;
  if (status === "suspended") return <Badge variant="warning">Suspended</Badge>;
  return <Badge variant="danger">Disabled</Badge>;
}

export function UsageDashboard({
  summary,
  limits,
  byAssistant,
  byModel,
  recent,
}: {
  summary: UsageSummary;
  limits: UsageLimits;
  byAssistant: UsageByAssistantRow[];
  byModel: UsageByModelRow[];
  recent: UsageRecentEvent[];
}) {
  const tone = usageBarTone(summary.usagePercent);
  const statTone =
    tone === "danger" ? "danger" : tone === "warning" ? "warning" : "default";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Usage"
        description="Hosted AI spend for the current billing period. Limits apply when enforcement is enabled on this instance."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/billing">Plans & billing</Link>
          </Button>
        }
      />

      {summary.usagePercent >= 70 ||
      (summary.monthlyRequestCap != null &&
        summary.monthlyRequestCap > 0 &&
        summary.requestCount / summary.monthlyRequestCap >= 0.7) ? (
        <Card className="border-warning/40 bg-warning/5 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6 text-sm">
            <p>
              {summary.usagePercent >= 100 ||
              (summary.monthlyRequestCap != null &&
                summary.requestCount >= summary.monthlyRequestCap)
                ? "You've reached your monthly hosted AI allowance. Upgrade your plan or wait until your usage period resets."
                : "You're approaching a plan limit."}
            </p>
            <Button asChild size="sm">
              <Link href="/dashboard/billing">Upgrade plan</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Current period
          </h2>
          {statusBadge(summary.status)}
          <Badge variant="outline">{formatPlanCode(summary.planCode)} plan</Badge>
        </div>

        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Period allowance</CardTitle>
            <CardDescription>
              {formatUsageDay(summary.periodStart)} – {formatUsageDay(summary.periodEnd)}
              {summary.monthlyRequestCap != null
                ? ` · Cap ${summary.requestCount.toLocaleString()} / ${summary.monthlyRequestCap.toLocaleString()} requests`
                : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2 text-sm">
              <p className="tabular-nums text-foreground">
                <span className="font-semibold">{formatUsdFromMicros(summary.consumedMicros + summary.reservedMicros)}</span>
                <span className="text-muted-foreground"> of {formatUsdFromMicros(summary.limitMicros)}</span>
              </p>
              <p className="tabular-nums text-muted-foreground">{summary.usagePercent}% used</p>
            </div>
            <UsageMeter percent={summary.usagePercent} tone={tone} />
            <p className="text-xs text-muted-foreground">
              Includes reserved in-flight spend. Resets {formatUsageDay(summary.periodEnd)}.
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Consumed"
            value={formatUsdFromMicros(summary.consumedMicros)}
            hint="Reconciled provider cost this period"
            tone={statTone}
          />
          <StatCard
            label="Reserved"
            value={formatUsdFromMicros(summary.reservedMicros)}
            hint="In-flight estimates not yet reconciled"
          />
          <StatCard
            label="Remaining"
            value={formatUsdFromMicros(summary.remainingMicros)}
            hint="Headroom before the hard limit"
            tone={summary.remainingMicros === 0 ? "danger" : "success"}
          />
          <StatCard
            label="Requests"
            value={summary.requestCount.toLocaleString()}
            hint={
              summary.monthlyRequestCap != null
                ? `Plan cap ${summary.monthlyRequestCap.toLocaleString()}`
                : "No request cap on this plan"
            }
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Limits</h2>
        <Card className="shadow-none">
          <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Effective ceiling</p>
              <p className="font-medium tabular-nums">{formatUsdFromMicros(limits.effectiveLimitMicros)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Plan default</p>
              <p className="font-medium tabular-nums">
                {limits.planLimitMicros == null ? "—" : formatUsdFromMicros(limits.planLimitMicros)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Account override</p>
              <p className="font-medium tabular-nums">
                {limits.limitOverrideMicros == null
                  ? "None"
                  : formatUsdFromMicros(limits.limitOverrideMicros)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Request cap</p>
              <p className="font-medium tabular-nums">
                {limits.monthlyRequestCap == null ? "None" : limits.monthlyRequestCap.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          By assistant
        </h2>
        {byAssistant.length === 0 ? (
          <EmptyState
            title="No usage yet"
            description="Hosted chat and ingest will show up here once this account meters activity."
            className="py-10"
          />
        ) : (
          <Card className="shadow-none">
            <ul className="divide-y divide-border">
              {byAssistant.map((row) => (
                <li
                  key={row.assistantId ?? "none"}
                  className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    {row.assistantId && row.assistantPublicId ? (
                      <Link
                        href={`/dashboard/assistants/${row.assistantId}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {row.assistantName ?? "Assistant"}
                      </Link>
                    ) : (
                      <p className="font-medium text-foreground">Unassigned</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {row.eventCount.toLocaleString()} events
                      {row.byokCostMicros > 0
                        ? ` · BYOK estimate ${formatUsdFromMicros(row.byokCostMicros)}`
                        : null}
                    </p>
                  </div>
                  <p className="shrink-0 font-medium tabular-nums">
                    {formatUsdFromMicros(row.costMicros)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          By model
        </h2>
        {byModel.length === 0 ? (
          <EmptyState
            title="No model breakdown yet"
            description="Provider calls appear here after metering records events."
            className="py-10"
          />
        ) : (
          <Card className="shadow-none overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Provider</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Operation</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium text-right">Events</th>
                  <th className="px-4 py-3 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {byModel.map((row) => (
                  <tr
                    key={`${row.provider}:${row.model}:${row.operation}:${row.billingMode}`}
                  >
                    <td className="px-4 py-2.5">{row.provider}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{row.model ?? "—"}</td>
                    <td className="px-4 py-2.5 capitalize">{row.operation.replaceAll("_", " ")}</td>
                    <td className="px-4 py-2.5 uppercase tracking-wide text-xs text-muted-foreground">
                      {row.billingMode}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.eventCount}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatUsdFromMicros(row.costMicros)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <EmptyState
            title="No recent events"
            description="Individual provider calls for this period will list here."
            className="py-10"
          />
        ) : (
          <Card className="shadow-none">
            <ul className="divide-y divide-border">
              {recent.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium">
                      <span className="capitalize">{event.operation.replaceAll("_", " ")}</span>
                      <span className="text-muted-foreground"> · {event.provider}</span>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {event.model ?? "—"}
                      {typeof event.metadata?.step === "string" ? ` · ${event.metadata.step}` : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.totalTokens.toLocaleString()} tokens · {event.billingMode} · {event.status}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">{formatUsdFromMicros(event.finalCostMicros)}</p>
                    <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>
                      {formatUsageDate(event.createdAt)}
                    </time>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
