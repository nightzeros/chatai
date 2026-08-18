import { NextResponse } from "next/server";

import { enqueueSourceSync } from "@/lib/enqueue-ingest";
import { requireSession } from "@/lib/session";
import { getOwnedSource, isSourceBusy } from "@/lib/sources";

type RouteContext = { params: Promise<{ id: string; sourceId: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, sourceId } = await context.params;
  const source = await getOwnedSource(session.user.id, id, sourceId);
  if (!source) {
    return NextResponse.json({ error: "Source not found." }, { status: 404 });
  }

  if (isSourceBusy(source.status)) {
    return NextResponse.json({ error: "This source is already syncing." }, { status: 409 });
  }

  await enqueueSourceSync(source.id);
  return NextResponse.json({ ok: true });
}
