import { notFound } from "next/navigation";

import { ConversationPrivacyActions } from "@/components/conversations/conversation-privacy-actions";
import { ConversationTranscript } from "@/components/conversations/conversation-transcript";
import { getOwnedAssistant } from "@/lib/assistants";
import { getOwnedConversationTranscript } from "@/lib/conversations";
import { requireSession } from "@/lib/session";

export default async function ConversationTranscriptPage({
  params,
}: {
  params: Promise<{ id: string; conversationId: string }>;
}) {
  const session = await requireSession();
  const { id, conversationId } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    notFound();
  }

  const transcript = await getOwnedConversationTranscript(
    session.user.id,
    assistant.id,
    conversationId,
  );
  if (!transcript) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <ConversationPrivacyActions assistantId={assistant.id} conversationId={conversationId} />
      <ConversationTranscript
        assistantId={assistant.id}
        sourceLabel={transcript.conversation.sourceLabel}
        visitorLabel={transcript.conversation.visitorLabel}
        createdAt={transcript.conversation.createdAt}
        updatedAt={transcript.conversation.updatedAt}
        messages={transcript.messages}
      />
    </div>
  );
}
