import { notFound } from "next/navigation";

import { SettingsForm } from "@/components/assistants/settings-form";
import { WidgetSigningCard } from "@/components/assistants/widget-signing-card";
import { getOwnedAssistant } from "@/lib/assistants";
import { redactAssistantForClient } from "@/lib/redact-assistant";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  const hasSigningSecret = Boolean(assistant.securitySettings?.widgetSigningSecret);
  const clientAssistant = redactAssistantForClient(assistant);

  return (
    <div className="flex flex-col gap-6">
      <SettingsForm
        assistant={clientAssistant}
        instanceDefaults={{
          chatProvider: env.AI_PROVIDER ?? "openai",
          chatModel: env.AI_MODEL,
          embeddingProvider: env.EMBEDDING_PROVIDER ?? "openai",
          embeddingModel: env.EMBEDDING_MODEL,
          embeddingDimensions: env.EMBEDDING_DIMENSIONS,
        }}
      />
      <WidgetSigningCard
        assistantId={assistant.id}
        requireWidgetSigning={Boolean(assistant.securitySettings?.requireWidgetSigning)}
        hasSigningSecret={hasSigningSecret}
      />
    </div>
  );
}
