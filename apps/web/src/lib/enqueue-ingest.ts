import { documents, eq, ingestJobs, sources } from "@chatai/database";

import { db } from "@/lib/db";
import { createId } from "@/lib/ids";

export async function enqueueIngest(documentId: string) {
  await db().insert(ingestJobs).values({
    id: createId(),
    kind: "ingest",
    documentId,
    status: "pending",
    attempts: 0,
  });

  await db()
    .update(documents)
    .set({ status: "pending", error: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

export async function enqueueSourceSync(sourceId: string) {
  await db().insert(ingestJobs).values({
    id: createId(),
    kind: "sync",
    sourceId,
    status: "pending",
    attempts: 0,
  });

  await db()
    .update(sources)
    .set({ status: "pending", error: null, updatedAt: new Date() })
    .where(eq(sources.id, sourceId));
}
