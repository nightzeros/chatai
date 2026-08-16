import { notFound } from "next/navigation";

import { KnowledgePanel } from "@/components/knowledge/knowledge-panel";
import { getOwnedAssistant } from "@/lib/assistants";
import { listDocumentsForAssistant } from "@/lib/documents";
import { requireSession } from "@/lib/session";

export default async function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    notFound();
  }

  const documents = await listDocumentsForAssistant(assistant.id);

  return (
    <KnowledgePanel
      assistantId={assistant.id}
      initialDocuments={documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        name: doc.name,
        status: doc.status,
        error: doc.error,
        chunkCount: doc.chunkCount,
        createdAt: doc.createdAt.toISOString(),
      }))}
    />
  );
}
