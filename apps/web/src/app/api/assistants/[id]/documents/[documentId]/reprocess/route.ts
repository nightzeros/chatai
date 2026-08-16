import { chunks, documents, eq } from "@chatai/database";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOwnedDocument } from "@/lib/documents";
import { enqueueIngest } from "@/lib/enqueue-ingest";
import { requireSession } from "@/lib/session";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const session = await requireSession();
  const { id, documentId } = await context.params;
  const document = await getOwnedDocument(session.user.id, id, documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  await db().delete(chunks).where(eq(chunks.documentId, document.id));
  await db()
    .update(documents)
    .set({ chunkCount: 0, error: null, status: "pending", updatedAt: new Date() })
    .where(eq(documents.id, document.id));
  await enqueueIngest(document.id);

  return NextResponse.json({ ok: true });
}
