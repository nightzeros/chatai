"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  ALL_PLAN_CODES,
  formatDisplayPrice,
  PLAN_CATALOG,
  type PlanCatalogEntry,
} from "@/lib/hosting/plan-catalog";
import {
  formatPlanCode,
  formatUsageDay,
  formatUsdFromMicros,
  usageBarTone,
} from "@/lib/hosting/format-usage";
import type { PaidHostingPlanCode, HostingPlanCode } from "@chatai/database";
import { cn } from "@/lib/utils";

export type BillingPageData = {
  planCode: HostingPlanCode;
  accountStatus: string;
  polarConfigured: boolean;
  hasSubscription: boolean;
  polarCustomerId: string | null;
  subscription: {
    status: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd?: boolean;
  } | null;
  periodStart: string;
  periodEnd: string;
  consumedMicros: number;
  reservedMicros: number;
  limitMicros: number;
  requestCount: number;
  monthlyRequestCap: number | null;
  assistantCount: number;
  maxAssistants: number;
  usagePercent: number;
  configuredPaidPlans: PaidHostingPlanCode[];
};

function Meter({
  label,
  usedLabel,
  percent,
}: {
  label: string;
  usedLabel: string;
  percent: number;
}) {
  const tone = usageBarTone(percent);
  const barClass =
    tone === "danger"
      ? "bg-destructive"
      : tone === "warning"
        ? "bg-warning"
        : "bg-primary";
  const width = Math.min(100, Math.max(0, percent));

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-2 text-sm">
        <p className="font-medium text-foreground">{label}</p>
        <p className="tabular-nums text-muted-foreground">{usedLabel}</p>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={cn("h-full rounded-full", barClass)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function PlanCard({
  entry,
  currentPlan,
  configured,
  polarConfigured,
  onUpgrade,
  busyPlan,
}: {
  entry: PlanCatalogEntry;
  currentPlan: HostingPlanCode;
  configured: boolean;
  polarConfigured: boolean;
  onUpgrade: (planCode: PaidHostingPlanCode) => void;
  busyPlan: string | null;
}) {
  const isCurrent = entry.planCode === currentPlan;
  const isPaid = entry.planCode !== "free";
  const canUpgrade =
    isPaid &&
    !isCurrent &&
    polarConfigured &&
    configured &&
    // Allow upgrading to a different paid tier (or from free)
    true;

  return (
    <Card
      className={cn(
        "shadow-none",
        isCurrent && "border-primary/40 ring-1 ring-primary/20",
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{entry.name}</CardTitle>
          {isCurrent ? <Badge variant="success">Current</Badge> : null}
        </div>
        <CardDescription>{entry.blurb}</CardDescription>
        <p className="pt-2 text-2xl font-semibold tracking-tight">
          {formatDisplayPrice(entry.displayPriceCents)}
          {entry.displayPriceCents > 0 ? (
            <span className="text-sm font-normal text-muted-foreground"> / mo</span>
          ) : null}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {entry.highlights.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
        {isCurrent ? (
          <Button variant="outline" disabled className="w-full">
            Current plan
          </Button>
        ) : !isPaid ? (
          <Button variant="outline" disabled className="w-full">
            Included
          </Button>
        ) : canUpgrade ? (
          <Button
            className="w-full"
            disabled={busyPlan !== null}
            onClick={() => onUpgrade(entry.planCode as PaidHostingPlanCode)}
          >
            {busyPlan === entry.planCode ? "Redirecting…" : `Upgrade to ${entry.name}`}
          </Button>
        ) : (
          <Button variant="outline" disabled className="w-full">
            {!polarConfigured ? "Billing unavailable" : "Not configured"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function BillingDashboard({ data }: { data: BillingPageData }) {
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPercent =
    data.monthlyRequestCap != null && data.monthlyRequestCap > 0
      ? Math.round((data.requestCount / data.monthlyRequestCap) * 100)
      : 0;
  const assistantPercent =
    data.maxAssistants > 0
      ? Math.round((data.assistantCount / data.maxAssistants) * 100)
      : 0;

  const nearLimit =
    data.usagePercent >= 70 ||
    requestPercent >= 70 ||
    assistantPercent >= 70;

  async function upgrade(planCode: PaidHostingPlanCode) {
    setError(null);
    setBusyPlan(planCode);
    try {
      const res = await fetch("/api/v1/account/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) {
        setError(json?.error ?? "Could not start checkout.");
        setBusyPlan(null);
        return;
      }
      window.location.href = json.url;
    } catch {
      setError("Could not start checkout.");
      setBusyPlan(null);
    }
  }

  async function openPortal() {
    setError(null);
    setPortalBusy(true);
    try {
      const res = await fetch("/api/v1/account/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: "/dashboard/billing" }),
      });
      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !json?.url) {
        setError(json?.error ?? "Could not open billing portal.");
        setPortalBusy(false);
        return;
      }
      window.location.href = json.url;
    } catch {
      setError("Could not open billing portal.");
      setPortalBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        description="Manage your plan, hosted AI allowance, and subscription."
        actions={
          data.hasSubscription && data.polarCustomerId ? (
            <Button variant="outline" onClick={openPortal} disabled={portalBusy}>
              {portalBusy ? "Opening…" : "Manage Billing"}
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {nearLimit ? (
        <Card className="border-warning/40 bg-warning/5 shadow-none">
          <CardContent className="pt-6 text-sm">
            You&apos;re approaching a plan limit.{" "}
            <span className="font-medium">Upgrade</span> below to keep hosted AI available.
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Current plan
          </h2>
          <Badge variant="outline">{formatPlanCode(data.planCode)}</Badge>
          {data.subscription?.status ? (
            <Badge variant="info">{data.subscription.status}</Badge>
          ) : (
            <Badge variant="outline">No subscription</Badge>
          )}
          {data.subscription?.cancelAtPeriodEnd ? (
            <Badge variant="warning">Cancels at period end</Badge>
          ) : null}
        </div>

        <Card className="shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Usage this period</CardTitle>
            <CardDescription>
              {formatUsageDay(data.periodStart)} – {formatUsageDay(data.periodEnd)}
              {data.subscription?.currentPeriodEnd
                ? ` · Renews/resets ${formatUsageDay(data.subscription.currentPeriodEnd)}`
                : ` · Resets ${formatUsageDay(data.periodEnd)}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Meter
              label="Hosted AI included"
              usedLabel={`${formatUsdFromMicros(data.consumedMicros + data.reservedMicros)} / ${formatUsdFromMicros(data.limitMicros)}`}
              percent={data.usagePercent}
            />
            <Meter
              label="Monthly chats/requests"
              usedLabel={
                data.monthlyRequestCap != null
                  ? `${data.requestCount.toLocaleString()} / ${data.monthlyRequestCap.toLocaleString()}`
                  : `${data.requestCount.toLocaleString()} (no cap)`
              }
              percent={requestPercent}
            />
            <Meter
              label="Assistants"
              usedLabel={`${data.assistantCount} / ${data.maxAssistants}`}
              percent={assistantPercent}
            />
            {data.usagePercent >= 100 ||
            (data.monthlyRequestCap != null && data.requestCount >= data.monthlyRequestCap) ? (
              <p className="text-sm text-destructive">
                Hosted AI usage is paused until your period resets or you upgrade.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Detailed spend breakdown lives on{" "}
              <Link href="/dashboard/usage" className="underline underline-offset-2">
                Usage
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label="Plan"
            value={formatPlanCode(data.planCode)}
            hint={data.accountStatus}
          />
          <StatCard
            label="Remaining AI"
            value={formatUsdFromMicros(
              Math.max(0, data.limitMicros - data.consumedMicros - data.reservedMicros),
            )}
          />
          <StatCard
            label="Assistants"
            value={`${data.assistantCount} / ${data.maxAssistants}`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Plans
        </h2>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {ALL_PLAN_CODES.map((code) => {
            const entry = PLAN_CATALOG[code];
            const configured =
              code === "free" ||
              data.configuredPaidPlans.includes(code as PaidHostingPlanCode);
            return (
              <PlanCard
                key={code}
                entry={entry}
                currentPlan={data.planCode}
                configured={configured}
                polarConfigured={data.polarConfigured}
                onUpgrade={upgrade}
                busyPlan={busyPlan}
              />
            );
          })}
        </div>
        {!data.polarConfigured ? (
          <p className="text-sm text-muted-foreground">
            Self-serve upgrades are not enabled on this instance. Contact support if you need a
            higher limit.
          </p>
        ) : null}
      </section>
    </div>
  );
}
