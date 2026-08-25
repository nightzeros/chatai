import { notFound } from "next/navigation";

import { SettingsForm } from "@/components/assistants/settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { redactAssistantForClient } from "@/lib/redact-assistant";
import { requireSession } from "@/lib/session";

export default async function GeneralSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="General"
        description="Name, welcome message, instructions, hallucination mode, and RAG guardrails."
      />
      <SettingsForm
        section="general"
        assistant={redactAssistantForClient(assistant)}
        instanceDefaults={{
          chatProvider: env.AI_PROVIDER ?? "openai",
          chatModel: env.AI_MODEL,
          embeddingProvider: env.EMBEDDING_PROVIDER ?? "openai",
          embeddingModel: env.EMBEDDING_MODEL,
          embeddingDimensions: env.EMBEDDING_DIMENSIONS,
        }}
      />
    </div>
  );
}
