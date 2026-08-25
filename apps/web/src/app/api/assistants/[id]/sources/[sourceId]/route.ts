import { eq, sources } from "@chatai/database";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { requireSession } from "@/lib/session";
import { getOwnedSource, listDocumentsForSource, isSourceBusy } from "@/lib/sources";

type RouteContext = { params: Promise<{ id: string; sourceId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, sourceId } = await context.params;
  const source = await getOwnedSource(session.user.id, id, sourceId);
  if (!source) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  const pages = await listDocumentsForSource(source.id);
  return NextResponse.json({ source, pages });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, sourceId } = await context.params;
  const source = await getOwnedSource(session.user.id, id, sourceId);
  if (!source) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  if (isSourceBusy(source.status)) {
    return NextResponse.json({ error: "Wait for the current sync to finish before deleting." }, { status: 409 });
  }

  await db().delete(sources).where(eq(sources.id, source.id));

  await logAuditEvent({
    userId: session.user.id,
    action: "source_deleted",
    resourceType: "source",
    resourceId: source.id,
    metadata: { assistantId: id, name: source.name, type: source.type },
  });

  return NextResponse.json({ ok: true });
}
