import Link from "next/link";
import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { HubTabs } from "@/components/assistants/hub-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistantAnalytics } from "@/lib/analytics";
import { getOwnedEvalQuality } from "@/lib/eval-quality";
import { requireSession } from "@/lib/session";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const [analytics, quality] = await Promise.all([
    getOwnedAssistantAnalytics(session.user.id, id),
    getOwnedEvalQuality(session.user.id, id),
  ]);
  if (!analytics || !quality) notFound();

  const base = `/dashboard/assistants/${analytics.assistant.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        description="Usage metrics and answer quality for this assistant."
        actions={
          <Link
            href={`${base}/insights/evals`}
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Open evaluations
          </Link>
        }
      />
      <HubTabs
        activeId="analytics"
        tabs={[
          { id: "analytics", label: "Analytics", href: `${base}/insights` },
          { id: "evals", label: "Evaluations", href: `${base}/insights/evals` },
        ]}
      />
      <AnalyticsDashboard
        embedded
        assistantId={analytics.assistant.id}
        metrics={analytics.metrics}
        topUnanswered={analytics.topUnanswered}
        quality={quality.quality}
      />
    </div>
  );
}
