import { notFound } from "next/navigation";

import { HubTabs } from "@/components/assistants/hub-tabs";
import { EvalPanel } from "@/components/evals/eval-panel";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistant } from "@/lib/assistants";
import { listEvalRunsForAssistant, listEvalSetsForAssistant } from "@/lib/eval-sets";
import { requireSession } from "@/lib/session";

export default async function InsightsEvalsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) notFound();

  const [sets, runs] = await Promise.all([
    listEvalSetsForAssistant(assistant.id),
    listEvalRunsForAssistant(assistant.id),
  ]);

  const base = `/dashboard/assistants/${assistant.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        description="Eval sets and runs that measure answer quality."
      />
      <HubTabs
        activeId="evals"
        tabs={[
          { id: "analytics", label: "Analytics", href: `${base}/insights` },
          { id: "evals", label: "Evaluations", href: `${base}/insights/evals` },
        ]}
      />
      <EvalPanel
        embedded
        assistantId={assistant.id}
        initialSets={sets.map((set) => ({
          id: set.id,
          name: set.name,
          cases: set.cases.map((item) => ({
            id: item.id,
            question: item.question,
            expectedAnswer: item.expectedAnswer,
          })),
        }))}
        initialRuns={runs.map((run) => ({
          id: run.id,
          evalSetId: run.evalSetId,
          kind: run.kind,
          status: run.status,
          summary: run.summary,
          createdAt: run.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}