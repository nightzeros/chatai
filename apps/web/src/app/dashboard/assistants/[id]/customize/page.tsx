import { notFound } from "next/navigation";

import { CustomizeForm } from "@/components/assistants/customize-form";
import { getOwnedAssistant } from "@/lib/assistants";
import { redactAssistantForClient } from "@/lib/redact-assistant";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function CustomizePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  return (
    <CustomizeForm
      assistant={redactAssistantForClient(assistant)}
      apiUrl={env.BETTER_AUTH_URL ?? "http://localhost:3000"}
    />
  );
}
