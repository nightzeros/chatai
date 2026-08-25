import { notFound } from "next/navigation";

import { InstallSnippetsPanel } from "@/components/assistants/install-snippets";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { buildInstallSnippets } from "@/lib/install-snippets";
import { requireSession } from "@/lib/session";

export default async function InstallPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  const deploymentOrigin = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const snippets = buildInstallSnippets({
    deploymentOrigin,
    publicId: assistant.publicId,
    requireWidgetSigning: Boolean(assistant.securitySettings?.requireWidgetSigning),
  });

  return <InstallSnippetsPanel snippets={snippets} />;
}
