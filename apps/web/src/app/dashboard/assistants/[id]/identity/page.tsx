import { notFound } from "next/navigation";

import { IdentityProfileSections } from "@/components/assistants/identity-sections";
import { SettingsForm } from "@/components/assistants/settings-form";
import { PageHeader } from "@/components/ui/page-header";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { redactAssistantForClient } from "@/lib/redact-assistant";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function IdentityPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) notFound();

  const clientAssistant = redactAssistantForClient(assistant);
  const instanceDefaults = {
    chatProvider: env.AI_PROVIDER ?? "openai",
    chatModel: env.AI_MODEL,
    embeddingProvider: env.EMBEDDING_PROVIDER ?? "openai",
    embeddingModel: env.EMBEDDING_MODEL,
    embeddingDimensions: env.EMBEDDING_DIMENSIONS,
  };

  return (
    <div className="flex max-w-2xl flex-col gap-10">
      <PageHeader
        title="Identity"
        description="Who this assistant is, what it may say, and the facts it can always use."
      />
      <ol className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <li>
          <a href="#basics" className="rounded-md border border-border px-2 py-1 hover:text-foreground">
            1. Basics
          </a>
        </li>
        {env.ASSISTANT_PROFILE ? (
          <>
            <li>
              <a href="#purpose" className="rounded-md border border-border px-2 py-1 hover:text-foreground">
                2. Purpose
              </a>
            </li>
            <li>
              <a href="#facts" className="rounded-md border border-border px-2 py-1 hover:text-foreground">
                3. Facts
              </a>
            </li>
            <li>
              <a href="#overview" className="rounded-md border border-border px-2 py-1 hover:text-foreground">
                4. Overview
              </a>
            </li>
          </>
        ) : null}
      </ol>
      <section id="basics" className="scroll-mt-6">
        <SettingsForm section="identity" assistant={clientAssistant} instanceDefaults={instanceDefaults} />
      </section>
      {env.ASSISTANT_PROFILE ? <IdentityProfileSections assistant={assistant} /> : null}
      <SettingsForm section="danger" assistant={clientAssistant} instanceDefaults={instanceDefaults} />
    </div>
  );
}
