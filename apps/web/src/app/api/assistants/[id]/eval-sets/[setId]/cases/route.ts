import { NextResponse } from "next/server";

import { createEvalCase, getOwnedEvalSet, parseEvalCaseInput } from "@/lib/eval-sets";
import { requireSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string; setId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, setId } = await context.params;
  const set = await getOwnedEvalSet(session.user.id, id, setId);
  if (!set) {
    return NextResponse.json({ error: "Eval set not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    expectedAnswer?: unknown;
  } | null;
  const parsed = parseEvalCaseInput(body ?? {});
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const evalCase = await createEvalCase(set.id, parsed);
  return NextResponse.json({ case: evalCase });
}
