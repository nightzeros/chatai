import { NextResponse } from "next/server";

import {
  deleteEvalSet,
  getOwnedEvalSet,
  listCasesForSet,
  parseEvalSetName,
  updateEvalSet,
} from "@/lib/eval-sets";
import { requireSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string; setId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, setId } = await context.params;
  const set = await getOwnedEvalSet(session.user.id, id, setId);
  if (!set) {
    return NextResponse.json({ error: "Eval set not found." }, { status: 404 });
  }

  const cases = await listCasesForSet(set.id);
  return NextResponse.json({ set, cases });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, setId } = await context.params;
  const set = await getOwnedEvalSet(session.user.id, id, setId);
  if (!set) {
    return NextResponse.json({ error: "Eval set not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const parsed = parseEvalSetName(body?.name);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await updateEvalSet(set.id, parsed.name);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, setId } = await context.params;
  const set = await getOwnedEvalSet(session.user.id, id, setId);
  if (!set) {
    return NextResponse.json({ error: "Eval set not found." }, { status: 404 });
  }

  await deleteEvalSet(set.id);
  return NextResponse.json({ ok: true });
}
