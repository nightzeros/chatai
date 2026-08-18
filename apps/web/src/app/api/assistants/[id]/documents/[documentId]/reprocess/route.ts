import { NextResponse } from "next/server";

import { getOwnedDocument } from "@/lib/documents";
import { reprocessDocument } from "@/lib/enqueue-reprocess";
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

  await reprocessDocument(document.id);

  return NextResponse.json({ ok: true });
}
