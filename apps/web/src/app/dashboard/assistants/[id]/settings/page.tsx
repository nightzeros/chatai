import { notFound } from "next/navigation";

import { ProviderSecretsCard } from "@/components/assistants/provider-secrets-card";
import { SettingsForm } from "@/components/assistants/settings-form";
import { WidgetSigningCard } from "@/components/assistants/widget-signing-card";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { redactAssistantForClient } from "@/lib/redact-assistant";
import { listProviderSecretMeta } from "@/lib/secrets/provider-secrets";
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
  const providerSecrets = await listProviderSecretMeta(assistant.id);
  const chatProvider =
    assistant.modelSettings?.chatProvider ?? env.AI_PROVIDER ?? "openai";
  const embeddingProvider =
    assistant.modelSettings?.embeddingProvider ?? env.EMBEDDING_PROVIDER ?? "openai";

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
      <ProviderSecretsCard
        assistantId={assistant.id}
        chatProvider={chatProvider}
        embeddingProvider={embeddingProvider}
        secrets={providerSecrets}
      />
      <WidgetSigningCard
        assistantId={assistant.id}
        requireWidgetSigning={Boolean(assistant.securitySettings?.requireWidgetSigning)}
        hasSigningSecret={hasSigningSecret}
      />
    </div>
  );
}
