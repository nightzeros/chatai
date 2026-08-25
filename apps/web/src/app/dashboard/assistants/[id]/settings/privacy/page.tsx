import { defaultPrivacySettings } from "@chatai/database";
import { notFound } from "next/navigation";

import { PrivacySettingsCard } from "@/components/assistants/privacy-settings-card";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistant } from "@/lib/assistants";
import { resolvePrivacyPolicy } from "@/lib/policies/resolve-privacy-policy";
import { requireSession } from "@/lib/session";

export default async function PrivacySettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) notFound();

  const privacy = resolvePrivacyPolicy(assistant.privacySettings ?? defaultPrivacySettings);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title="Privacy"
        description="Control whether visitor chats are stored, how long they are kept, and whether visitor ids are anonymized. This is product privacy configuration — not a compliance certification."
      />
      <PrivacySettingsCard
        assistantId={assistant.id}
        storeConversations={privacy.storeConversations}
        retentionDays={privacy.retentionDays}
        anonymizeVisitorIds={privacy.anonymizeVisitorIds}
      />
    </div>
  );
}
