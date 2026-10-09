import { eq, voiceSessions } from "@chatai/database";
import { z } from "zod";

import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import {
  getVoiceRuntime,
  logVoiceWarning,
  ownedByLiveForeignRuntime,
  subscribeVoiceGate,
  verifyVoiceControlToken,
  voiceGateOf,
  type VoiceGateDecision,
} from "@/lib/voice";

const bodySchema = z.object({ token: z.string().min(1).max(1_024) });

type RouteContext = { params: Promise<{ sessionId: string }> };

const NOT_FOUND = { error: "Voice session not found." };
/** Keeps proxies from closing an idle stream between decisions. */
const GATE_KEEPALIVE_MS = 10_000;
/** A widget holds one stream; a few allow overlap while it reconnects. */
const MAX_STREAMS_PER_SESSION = 4;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

function gateLine(decision: VoiceGateDecision): string {
  return `${JSON.stringify({ type: "gate", ...decision })}\n`;
}

/**
 * POST /api/v1/voice/sessions/:sessionId/gate
 *
 * Playback gate for a live Voice call, as NDJSON: the current decision first, then
 * every decision as the server makes it (`{"type":"gate","seq","state","reason",
 * "inputEndMs"}`), a `{"type":"keepalive"}` every 10 s, and `{"type":"end"}` when
 * the call ends. The client plays assistant audio and captions only while the
 * latest decision is `open`. Authorized by the mint's `controlToken`, like
 * heartbeats; decisions carry no conversation content.
 */
export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!sessionId?.trim() || !parsed.success) {
    return jsonWithCors(NOT_FOUND, { status: 404 });
  }
  if (!verifyVoiceControlToken(parsed.data.token, sessionId).ok) {
    return jsonWithCors(NOT_FOUND, { status: 404 });
  }

  const runtime = getVoiceRuntime(sessionId);
  if (!runtime) {
    const [row] = await db()
      .select({
        meteringStatus: voiceSessions.meteringStatus,
        runtimeInstanceId: voiceSessions.runtimeInstanceId,
        usageCheckpointAt: voiceSessions.usageCheckpointAt,
      })
      .from(voiceSessions)
      .where(eq(voiceSessions.id, sessionId))
      .limit(1);
    if (row && ownedByLiveForeignRuntime(row)) {
      logVoiceWarning("runtime.misrouted", { sessionId, route: "gate" });
      return jsonWithCors({ error: "Voice session is handled elsewhere.", reason: "misrouted" }, { status: 421 });
    }
    return jsonWithCors(NOT_FOUND, { status: 404 });
  }

  const gate = voiceGateOf(runtime);
  if (gate.ended) return jsonWithCors(NOT_FOUND, { status: 404 });
  if (gate.listeners.size >= MAX_STREAMS_PER_SESSION) {
    return jsonWithCors({ error: "Too many gate streams." }, { status: 429, headers: { "Retry-After": "1" } });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      const send = (line: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          finish();
        }
      };

      send(gateLine(gate.decision));
      const unsubscribe = subscribeVoiceGate(runtime, (decision) => {
        if (decision) {
          send(gateLine(decision));
          return;
        }
        send(`${JSON.stringify({ type: "end" })}\n`);
        finish();
      });
      const keepalive = setInterval(() => send(`${JSON.stringify({ type: "keepalive" })}\n`), GATE_KEEPALIVE_MS);
      keepalive.unref?.();
      cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
      };
      if (closed) cleanup();
      request.signal.addEventListener("abort", finish, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
