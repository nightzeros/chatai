import { NextResponse } from "next/server";

import { getOwnedAssistant } from "@/lib/assistants";
import { getSession } from "@/lib/session";
import { getVoiceRuntime, recordVoiceHeartbeat, serializeVoiceDebug } from "@/lib/voice";

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

/**
 * Owner-only playground debug view of a live voice session (turns, RAG timings,
 * supersession counters). Reads the process-local runtime; nothing is persisted.
 */
export async function GET(_request: Request, context: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id, sessionId } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  const runtime = getVoiceRuntime(sessionId);
  if (!assistant || !runtime || runtime.assistantId !== assistant.id) {
    return NextResponse.json({ error: "Voice session not found." }, { status: 404 });
  }
  // The owner's snapshot poll doubles as the Playground heartbeat.
  recordVoiceHeartbeat(runtime);
  return NextResponse.json(serializeVoiceDebug(runtime), {
    headers: { "Cache-Control": "no-store" },
  });
}
