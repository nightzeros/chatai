import { assistants, eq, voiceSessions } from "@chatai/database";
import { z } from "zod";

import { usesApiKeyAuth } from "@/lib/api-keys";
import { getOwnedAssistantByRef } from "@/lib/assistants";
import { authorizeV1 } from "@/lib/authorize-v1";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";
import { consumeApiKeyRateLimit } from "@/lib/rate-limit";
import {
  assertPlaygroundOwner,
  getEndedVoiceSession,
  getVoiceRuntime,
  logVoiceWarning,
  ownedByLiveForeignRuntime,
  publicEndResult,
  terminateVoiceSession,
} from "@/lib/voice";

const bodySchema = z.object({
  reason: z
    .enum(["close_requested", "remote_hangup", "connection_lost", "error"])
    .optional(),
  visitorId: z.string().min(1).max(80).optional(),
  /** Ignored for authorization — the session's minted source is authoritative. */
  source: z.enum(["playground", "widget", "api"]).optional(),
});

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/v1/voice/sessions/:sessionId/end
 * Graceful close: sideband session.close → wait for session.closed → finalize usage,
 * wipe in-memory conversational buffers, unregister runtime.
 *
 * Authorization mirrors mint: API key must own the assistant; widget callers pass
 * SecurityPolicy under the session's original source; playground requires owner.
 */
export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  if (!sessionId?.trim()) {
    return jsonWithCors({ error: "sessionId is required." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return jsonWithCors(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  // A session ChatAI already ended (usage limit, superseded, TTL) answers from a
  // short-lived tombstone so the client learns why, under the same authorization.
  const runtime = getVoiceRuntime(sessionId);
  const ended = runtime ? undefined : getEndedVoiceSession(sessionId);
  const target = runtime ?? ended;
  if (!target) {
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
      logVoiceWarning("runtime.misrouted", { sessionId, route: "end" });
      return jsonWithCors({ error: "Voice session is handled elsewhere.", reason: "misrouted" }, { status: 421 });
    }
    return jsonWithCors({ error: "Voice session not found." }, { status: 404 });
  }

  if (usesApiKeyAuth(request)) {
    const auth = await authorizeV1(request, ["voice"]);
    if (!auth.ok) {
      return jsonWithCors({ error: auth.error }, { status: auth.status });
    }
    const limited = await consumeApiKeyRateLimit(auth.apiKeyId);
    if (!limited.ok) {
      return jsonWithCors(
        { error: "Rate limit exceeded." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }
    const owned = await getOwnedAssistantByRef(auth.userId, target.assistantId);
    if (!owned) {
      // Same response as unknown session — do not confirm existence to non-owners.
      return jsonWithCors({ error: "Voice session not found." }, { status: 404 });
    }
  } else {
    const [assistant] = await db()
      .select()
      .from(assistants)
      .where(eq(assistants.id, target.assistantId))
      .limit(1);
    if (!assistant) {
      return jsonWithCors({ error: "Voice session not found." }, { status: 404 });
    }

    const playground = await assertPlaygroundOwner({
      source: target.source,
      assistantOwnerId: assistant.userId,
    });
    if (!playground.ok) {
      return jsonWithCors({ error: playground.error }, { status: playground.status });
    }

    const security = SecurityPolicy.fromAssistant(assistant, env);
    const violation = await security.enforceWidgetRequest(request, {
      visitorId: parsed.data.visitorId ?? target.visitorId ?? undefined,
      source: target.source,
    });
    if (violation) {
      return policyViolationResponse(violation);
    }

    if (target.visitorId && parsed.data.visitorId !== target.visitorId) {
      return jsonWithCors({ error: "Visitor mismatch." }, { status: 403 });
    }
  }

  if (!runtime) return jsonWithCors(publicEndResult(ended!.result, target.source));

  const result = await terminateVoiceSession(runtime, {
    reason: parsed.data.reason ?? "close_requested",
    requestProviderClose: true,
  });

  return jsonWithCors(publicEndResult(result, target.source));
}
