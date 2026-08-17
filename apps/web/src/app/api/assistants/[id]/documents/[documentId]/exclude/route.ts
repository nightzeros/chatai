import { documents, eq } from "@chatai/database";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOwnedDocument } from "@/lib/documents";
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

  if (document.type !== "url") {
    return NextResponse.json({ error: "Only crawled pages can be excluded." }, { status: 400 });
  }

  const excluded = !document.excluded;
  await db()
    .update(documents)
    .set({ excluded, updatedAt: new Date() })
    .where(eq(documents.id, document.id));

  return NextResponse.json({ ok: true, excluded });
}
