import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { getOwnedAssistantAnalytics } from "@/lib/analytics";
import { requireSession } from "@/lib/session";

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const analytics = await getOwnedAssistantAnalytics(session.user.id, id);
  if (!analytics) {
    notFound();
  }

  return (
    <AnalyticsDashboard
      assistantId={analytics.assistant.id}
      metrics={analytics.metrics}
      topUnanswered={analytics.topUnanswered}
    />
  );
}
