import { chunks, documents, eq } from "@chatai/database";

import { db } from "@/lib/db";
import { enqueueIngest } from "@/lib/enqueue-ingest";

export async function reprocessDocument(documentId: string) {
  await db().delete(chunks).where(eq(chunks.documentId, documentId));
  await db()
    .update(documents)
    .set({ chunkCount: 0, error: null, status: "pending", updatedAt: new Date() })
    .where(eq(documents.id, documentId));
  await enqueueIngest(documentId);
}

/** Delete chunks and re-enqueue ingest for every document on an assistant. */
export async function enqueueReprocessForAssistant(assistantId: string) {
  const rows = await db()
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.assistantId, assistantId));

  for (const row of rows) {
    await reprocessDocument(row.id);
  }
}
