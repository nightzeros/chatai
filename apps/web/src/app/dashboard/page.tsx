import { AssistantCard } from "@/components/assistants/assistant-card";
import { CreateAssistantDialog } from "@/components/assistants/create-assistant-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listAssistantsForUser } from "@/lib/assistants";
import { listAssistantDashboardStats } from "@/lib/assistant-overview";
import { requireSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await requireSession();
  const assistants = await listAssistantsForUser(session.user.id);
  const stats = await listAssistantDashboardStats(session.user.id);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Assistants"
        description="Create an assistant, add knowledge, then embed it on your site."
        actions={<CreateAssistantDialog />}
      />

      {assistants.length === 0 ? (
        <EmptyState
          title="No assistants yet"
          description="Create one to start uploading documents and testing chat."
          action={<CreateAssistantDialog />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assistants.map((assistant) => (
            <AssistantCard key={assistant.id} assistant={assistant} stats={stats.get(assistant.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
