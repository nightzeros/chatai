import { eq, voiceSessions } from "@chatai/database";
import { z } from "zod";

import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import {
  getEndedVoiceSession,
  getVoiceRuntime,
  logVoiceEvent,
  logVoiceWarning,
  ownedByLiveForeignRuntime,
  publicEndResult,
  publicVoiceEndReason,
  recordVoiceHeartbeat,
  recoverOrphanedVoiceSession,
  verifyVoiceControlToken,
  voiceControlHealth,
  voiceControlSettings,
} from "@/lib/voice";

const bodySchema = z.object({ token: z.string().min(1).max(1_024) });

type RouteContext = { params: Promise<{ sessionId: string }> };

/** Per-session cap: heartbeats come every 5 s (2 s while reconnecting). */
const MIN_HEARTBEAT_INTERVAL_MS = 1_000;
const lastHeartbeatKey = "__chatai_voice_last_heartbeat__";

function lastHeartbeats(): Map<string, number> {
  const g = globalThis as typeof globalThis & { [lastHeartbeatKey]?: Map<string, number> };
  g[lastHeartbeatKey] ??= new Map();
  return g[lastHeartbeatKey];
}

function rateLimited(sessionId: string, now: number): boolean {
  const map = lastHeartbeats();
  if (map.size > 10_000) {
    for (const [id, at] of map) if (now - at > 60_000) map.delete(id);
  }
  const previous = map.get(sessionId);
  if (previous !== undefined && now - previous < MIN_HEARTBEAT_INTERVAL_MS) return true;
  map.set(sessionId, now);
  return false;
}

const NOT_FOUND = { error: "Voice session not found." };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/v1/voice/sessions/:sessionId/heartbeat
 *
 * Control-plane liveness for a live Voice call. The per-session `controlToken` from
 * mint is the only authorization (no widget SecurityPolicy budget is consumed).
 * Answers `healthy` | `degraded` | `ended` | `lost` plus `nextHeartbeatMs`; widget
 * callers only ever see public end reasons.
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

  const now = Date.now();
  if (rateLimited(sessionId, now)) {
    return jsonWithCors({ error: "Too many heartbeats." }, { status: 429, headers: { "Retry-After": "1" } });
  }

  const { heartbeatIntervalMs } = voiceControlSettings();
  const runtime = getVoiceRuntime(sessionId);
  if (runtime) {
    recordVoiceHeartbeat(runtime);
    const state = voiceControlHealth(runtime);
    // Ending (e.g. graceful shutdown drain): say so now, before the provider close lands.
    const endReason =
      state === "ended" && runtime.endReason
        ? runtime.source === "widget"
          ? publicVoiceEndReason(runtime.endReason)
          : runtime.endReason
        : undefined;
    return jsonWithCors({
      state,
      ...(endReason ? { endReason } : {}),
      nextHeartbeatMs: state === "degraded" ? Math.min(2_000, heartbeatIntervalMs) : heartbeatIntervalMs,
    });
  }

  const ended = getEndedVoiceSession(sessionId);
  if (ended) {
    return jsonWithCors({
      state: "ended",
      endReason: publicEndResult(ended.result, ended.source).endReason,
      nextHeartbeatMs: heartbeatIntervalMs,
    });
  }

  const [row] = await db()
    .select({
      id: voiceSessions.id,
      providerSessionId: voiceSessions.providerSessionId,
      usageCheckpointAt: voiceSessions.usageCheckpointAt,
      meteringStatus: voiceSessions.meteringStatus,
      runtimeInstanceId: voiceSessions.runtimeInstanceId,
    })
    .from(voiceSessions)
    .where(eq(voiceSessions.id, sessionId))
    .limit(1);
  if (!row) return jsonWithCors(NOT_FOUND, { status: 404 });

  if (row.meteringStatus !== "open") {
    return jsonWithCors({ state: "ended", nextHeartbeatMs: heartbeatIntervalMs });
  }

  if (ownedByLiveForeignRuntime(row, now)) {
    logVoiceWarning("runtime.misrouted", { sessionId });
    return jsonWithCors({ error: "Voice session is handled elsewhere.", reason: "misrouted" }, { status: 421 });
  }

  // The owning runtime is gone while the provider session may still be live:
  // end it now (attach → hangup → session.closed) for provider-final usage.
  logVoiceEvent("heartbeat.lost", { sessionId });
  void recoverOrphanedVoiceSession(
    { id: row.id, providerSessionId: row.providerSessionId, usageCheckpointAt: row.usageCheckpointAt },
    { trigger: "heartbeat" },
  ).catch(() => undefined);
  return jsonWithCors({ state: "lost", nextHeartbeatMs: heartbeatIntervalMs });
}
