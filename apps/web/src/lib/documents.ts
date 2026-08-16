import { and, desc, documents, eq } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";

export type Document = typeof documents.$inferSelect;

export async function listDocumentsForAssistant(assistantId: string) {
  return db()
    .select()
    .from(documents)
    .where(eq(documents.assistantId, assistantId))
    .orderBy(desc(documents.createdAt));
}

export async function getOwnedDocument(userId: string, assistantId: string, documentId: string) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const [document] = await db()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.assistantId, assistantId)))
    .limit(1);

  return document ?? null;
}
