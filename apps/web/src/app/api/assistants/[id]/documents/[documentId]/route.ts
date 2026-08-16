import { unlink } from "node:fs/promises";

import { documents, eq } from "@chatai/database";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getOwnedDocument } from "@/lib/documents";
import { requireSession } from "@/lib/session";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  const session = await requireSession();
  const { id, documentId } = await context.params;
  const document = await getOwnedDocument(session.user.id, id, documentId);
  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  await db().delete(documents).where(eq(documents.id, document.id));

  if (document.storagePath) {
    await unlink(document.storagePath).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
