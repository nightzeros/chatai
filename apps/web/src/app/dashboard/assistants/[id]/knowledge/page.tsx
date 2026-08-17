import { notFound } from "next/navigation";

import { KnowledgePanel } from "@/components/knowledge/knowledge-panel";
import { getOwnedAssistant } from "@/lib/assistants";
import { listDocumentsForAssistant } from "@/lib/documents";
import { requireSession } from "@/lib/session";
import { listDocumentsForSource, listSourcesForAssistant } from "@/lib/sources";

export default async function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    notFound();
  }

  const [documents, sourceRows] = await Promise.all([
    listDocumentsForAssistant(assistant.id),
    listSourcesForAssistant(assistant.id),
  ]);

  const initialSources = await Promise.all(
    sourceRows.map(async (source) => ({
      source,
      pages: await listDocumentsForSource(source.id),
    })),
  );

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
        url: doc.url,
        excluded: doc.excluded,
        sourceId: doc.sourceId,
      }))}
      initialSources={initialSources.map(({ source, pages }) => ({
        source: {
          id: source.id,
          name: source.name,
          status: source.status,
          error: source.error,
          config: source.config,
          lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
        },
        pages: pages.map((page) => ({
          id: page.id,
          type: page.type,
          name: page.name,
          status: page.status,
          error: page.error,
          chunkCount: page.chunkCount,
          createdAt: page.createdAt.toISOString(),
          url: page.url,
          excluded: page.excluded,
          sourceId: page.sourceId,
        })),
      }))}
    />
  );
}
