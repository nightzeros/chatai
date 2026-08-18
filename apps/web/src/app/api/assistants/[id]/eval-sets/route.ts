import { NextResponse } from "next/server";

import { getOwnedAssistant } from "@/lib/assistants";
import { createEvalSet, listEvalSetsForAssistant, parseEvalSetName } from "@/lib/eval-sets";
import { requireSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const sets = await listEvalSetsForAssistant(assistant.id);
  return NextResponse.json({ sets });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const parsed = parseEvalSetName(body?.name);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const set = await createEvalSet(assistant.id, parsed.name);
  return NextResponse.json({ set });
}
