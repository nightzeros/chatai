import { notFound } from "next/navigation";

import { WorkspaceNav } from "@/components/assistants/workspace-nav";
import { getOwnedAssistant } from "@/lib/assistants";
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{assistant.name}</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{assistant.publicId}</p>
        {assistant.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{assistant.description}</p>
        ) : null}
      </div>
      <WorkspaceNav assistantId={assistant.id} />
      {children}
    </div>
  );
}
