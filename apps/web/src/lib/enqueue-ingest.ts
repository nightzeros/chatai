import { documents, eq, ingestJobs } from "@chatai/database";

import { db } from "@/lib/db";
import { createId } from "@/lib/ids";

export async function enqueueIngest(documentId: string) {
  await db().insert(ingestJobs).values({
    id: createId(),
    documentId,
    status: "pending",
    attempts: 0,
  });

  await db()
    .update(documents)
    .set({ status: "pending", error: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}
