import { Suspense } from "react";
import { notFound } from "next/navigation";

import { CustomizeForm } from "@/components/assistants/customize-form";
import { HubQueryTabs } from "@/components/assistants/hub-tabs";
import { InstallSnippetsPanel } from "@/components/assistants/install-snippets";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { buildInstallSnippets } from "@/lib/install-snippets";
import { redactAssistantForClient } from "@/lib/redact-assistant";
import { requireSession } from "@/lib/session";

export default async function WidgetHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) notFound();

  const tab = tabParam === "embed" ? "embed" : "appearance";
  const deploymentOrigin = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  const snippets = buildInstallSnippets({
    deploymentOrigin,
    publicId: assistant.publicId,
    requireWidgetSigning: Boolean(assistant.securitySettings?.requireWidgetSigning),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Widget"
        description="How visitors see the assistant on your site, and how to install it."
      />
      <Suspense fallback={null}>
        <HubQueryTabs
          defaultId="appearance"
          tabs={[
            { id: "appearance", label: "Appearance" },
            { id: "embed", label: "Embed" },
          ]}
        />
      </Suspense>
      {tab === "appearance" ? (
        <CustomizeForm
          assistant={redactAssistantForClient(assistant)}
          apiUrl={deploymentOrigin}
          embedded
        />
      ) : (
        <InstallSnippetsPanel
          snippets={snippets}
          requireWidgetSigning={Boolean(assistant.securitySettings?.requireWidgetSigning)}
          embedded
        />
      )}
    </div>
  );
}
