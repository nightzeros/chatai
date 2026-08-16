import { notFound } from "next/navigation";

import { SettingsForm } from "@/components/assistants/settings-form";
import { getOwnedAssistant } from "@/lib/assistants";
import { requireSession } from "@/lib/session";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  return <SettingsForm assistant={assistant} />;
}
