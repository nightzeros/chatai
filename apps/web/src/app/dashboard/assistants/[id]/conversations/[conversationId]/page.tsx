import { notFound } from "next/navigation";

import { ConversationPrivacyActions } from "@/components/conversations/conversation-privacy-actions";
import { ConversationTranscript } from "@/components/conversations/conversation-transcript";
import { getOwnedAssistant } from "@/lib/assistants";
import { getOwnedConversationReview } from "@/lib/conversation-review";
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

  const review = await getOwnedConversationReview(session.user.id, assistant.id, conversationId);
  if (!review) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <ConversationPrivacyActions assistantId={assistant.id} conversationId={conversationId} />
      <ConversationTranscript
        assistantId={assistant.id}
        sourceLabel={review.conversation.sourceLabel}
        visitorLabel={review.conversation.visitorLabel}
        createdAt={review.conversation.createdAt}
        updatedAt={review.conversation.updatedAt}
        entries={review.entries}
      />
    </div>
  );
}
