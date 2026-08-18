import { NextResponse } from "next/server";

import { getOwnedAssistant } from "@/lib/assistants";
import { getOwnedEvalSet, listEvalRunsForAssistant, startOfflineEvalRun } from "@/lib/eval-sets";
import { requireSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const runs = await listEvalRunsForAssistant(assistant.id);
  return NextResponse.json({ runs });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { evalSetId?: unknown } | null;
  const evalSetId = typeof body?.evalSetId === "string" ? body.evalSetId : "";
  if (!evalSetId) {
    return NextResponse.json({ error: "evalSetId is required." }, { status: 400 });
  }

  const set = await getOwnedEvalSet(session.user.id, assistant.id, evalSetId);
  if (!set) {
    return NextResponse.json({ error: "Eval set not found." }, { status: 404 });
  }

  try {
    const runId = await startOfflineEvalRun(assistant.id, set.id);
    return NextResponse.json({ runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start eval run.";
    if (message.toLowerCase().includes("at least one")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    throw error;
  }
}
