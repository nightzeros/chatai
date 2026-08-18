import { NextResponse } from "next/server";

import { getEvalRunDetails } from "@/lib/eval-run-details";
import { getOwnedAssistant } from "@/lib/assistants";
import { requireSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string; runId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id, runId } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const details = await getEvalRunDetails(session.user.id, assistant.id, runId);
  if (!details) {
    return NextResponse.json({ error: "Eval run not found." }, { status: 404 });
  }

  return NextResponse.json(details);
}
