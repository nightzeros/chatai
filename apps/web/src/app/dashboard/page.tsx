import { AssistantCard } from "@/components/assistants/assistant-card";
import { CreateAssistantDialog } from "@/components/assistants/create-assistant-dialog";
import { listAssistantsForUser } from "@/lib/assistants";
import { requireSession } from "@/lib/session";

export default async function DashboardPage() {
  const session = await requireSession();
  const assistants = await listAssistantsForUser(session.user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Assistants</h1>
          <p className="mt-1 text-muted-foreground">Create an assistant, add knowledge, then embed it on your site.</p>
        </div>
        <CreateAssistantDialog />
      </div>

      {assistants.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
          <p className="text-sm font-medium">No assistants yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one to start uploading documents and testing chat.</p>
          <div className="mt-5 flex justify-center">
            <CreateAssistantDialog />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assistants.map((assistant) => (
            <AssistantCard key={assistant.id} assistant={assistant} />
          ))}
        </div>
      )}
    </div>
  );
}
