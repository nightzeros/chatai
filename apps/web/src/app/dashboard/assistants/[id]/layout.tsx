import { notFound } from "next/navigation";

import { WorkspaceContextBar } from "@/components/assistants/workspace-nav";
import { AssistantWorkspaceRegistrar } from "@/components/layout/assistant-workspace-context";
import { getOwnedAssistant, listAssistantsForUser } from "@/lib/assistants";
import { requireSession } from "@/lib/session";

export default async function AssistantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  const siblings = await listAssistantsForUser(session.user.id);

  return (
    <AssistantWorkspaceRegistrar
      workspace={{
        id: assistant.id,
        name: assistant.name,
        publicId: assistant.publicId,
        siblings: siblings.map((a) => ({ id: a.id, name: a.name })),
      }}
    >
      <div className="flex flex-col gap-5 sm:gap-6">
        <WorkspaceContextBar
          assistantId={assistant.id}
          assistantName={assistant.name}
          publicId={assistant.publicId}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </AssistantWorkspaceRegistrar>
  );
}
