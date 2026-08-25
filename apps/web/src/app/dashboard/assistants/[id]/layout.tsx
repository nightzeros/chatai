import Link from "next/link";
import { notFound } from "next/navigation";

import { AssistantSwitcher } from "@/components/assistants/assistant-switcher";
import { WorkspaceNav } from "@/components/assistants/workspace-nav";
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
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-52">
        <div className="mb-4 space-y-1">
          <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground">
            ← Assistants
          </Link>
          <h1 className="truncate text-lg font-semibold tracking-tight">{assistant.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">{assistant.publicId}</p>
          <AssistantSwitcher
            currentId={assistant.id}
            assistants={siblings.map((a) => ({ id: a.id, name: a.name }))}
          />
        </div>
        <WorkspaceNav assistantId={assistant.id} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
