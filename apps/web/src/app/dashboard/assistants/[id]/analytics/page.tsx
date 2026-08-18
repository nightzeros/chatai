import { notFound } from "next/navigation";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { getOwnedAssistantAnalytics } from "@/lib/analytics";
import { getOwnedEvalQuality } from "@/lib/eval-quality";
import { requireSession } from "@/lib/session";

export default async function AnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const [analytics, quality] = await Promise.all([
    getOwnedAssistantAnalytics(session.user.id, id),
    getOwnedEvalQuality(session.user.id, id),
  ]);
  if (!analytics || !quality) {
    notFound();
  }

  return (
    <AnalyticsDashboard
      assistantId={analytics.assistant.id}
      metrics={analytics.metrics}
      topUnanswered={analytics.topUnanswered}
      quality={quality.quality}
    />
  );
}
