import { and, desc, documents, eq, sources } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";

export type Source = typeof sources.$inferSelect;

export {
  buildWebsiteSourceConfig,
  createWebsiteSource,
  DuplicateWebsiteSourceError,
  DUPLICATE_WEBSITE_SOURCE_MESSAGE,
  sourceNameFromUrl,
} from "@/lib/website-source-create";

export async function listSourcesForAssistant(assistantId: string) {
  return db()
    .select()
    .from(sources)
    .where(eq(sources.assistantId, assistantId))
    .orderBy(desc(sources.updatedAt));
}

export async function listDocumentsForSource(sourceId: string) {
  return db()
    .select()
    .from(documents)
    .where(eq(documents.sourceId, sourceId))
    .orderBy(desc(documents.createdAt));
}

export async function getOwnedSource(userId: string, assistantId: string, sourceId: string) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const [source] = await db()
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.assistantId, assistantId)))
    .limit(1);

  return source ?? null;
}

export function isSourceBusy(status: Source["status"]) {
  return status === "pending" || status === "syncing";
}
