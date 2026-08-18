import { NextResponse } from "next/server";

import { deleteEvalCase, getOwnedEvalCase, parseEvalCaseInput, updateEvalCase } from "@/lib/eval-sets";
import { requireSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string; setId: string; caseId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, setId, caseId } = await context.params;
  const evalCase = await getOwnedEvalCase(session.user.id, id, setId, caseId);
  if (!evalCase) {
    return NextResponse.json({ error: "Eval case not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    expectedAnswer?: unknown;
  } | null;
  const parsed = parseEvalCaseInput(body ?? {});
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  await updateEvalCase(evalCase.id, evalCase.evalSetId, parsed);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, setId, caseId } = await context.params;
  const evalCase = await getOwnedEvalCase(session.user.id, id, setId, caseId);
  if (!evalCase) {
    return NextResponse.json({ error: "Eval case not found." }, { status: 404 });
  }

  await deleteEvalCase(evalCase.id, evalCase.evalSetId);
  return NextResponse.json({ ok: true });
}
