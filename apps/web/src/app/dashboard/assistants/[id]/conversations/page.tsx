import { notFound } from "next/navigation";

import { ConversationList } from "@/components/conversations/conversation-list";
import { listOwnedConversations } from "@/lib/conversations";
import { requireSession } from "@/lib/session";

export default async function ConversationsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const conversations = await listOwnedConversations(session.user.id, id);
  if (!conversations) {
    notFound();
  }

  return (
    <ConversationList
      assistantId={id}
      items={conversations.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }))}
    />
  );
}
