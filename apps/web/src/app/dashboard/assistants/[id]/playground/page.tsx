import { notFound } from "next/navigation";

import { PlaygroundChat } from "@/components/playground/playground-chat";
import { getOwnedAssistant } from "@/lib/assistants";
import { requireSession } from "@/lib/session";

export default async function PlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  return (
    <PlaygroundChat
      publicId={assistant.publicId}
      name={assistant.name}
      welcomeMessage={assistant.welcomeMessage}
    />
  );
}
