import { notFound } from "next/navigation";

import { ConversationList } from "@/components/conversations/conversation-list";
import { parseConversationTypeFilter } from "@/lib/conversation-list";
import { listOwnedConversationReviewItems } from "@/lib/conversations";
import { requireSession } from "@/lib/session";

export default async function ConversationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const filter = parseConversationTypeFilter((await searchParams).type);
  const conversations = await listOwnedConversationReviewItems(session.user.id, id, filter);
  if (!conversations) {
    notFound();
  }

  return (
    <ConversationList
      assistantId={id}
      filter={filter}
      items={conversations.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }))}
    />
  );
}
