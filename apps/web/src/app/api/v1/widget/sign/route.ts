import { assistants, eq } from "@chatai/database";
import { z } from "zod";

import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  createWidgetSignature,
} from "@/lib/policies/checks/widget-signature";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";

const bodySchema = z.object({
  assistantId: z.string().min(1, "assistantId is required"),
  visitorId: z.string().min(8).max(80),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * Issues a short-lived HMAC for widget chat when signing is configured.
 * Applies domain allowlist + rate limits + visitor bot checks; skips signature
 * verification (this endpoint creates the signature — requiring one would recurse).
 * Signatures are reusable within WIDGET_SIGNING_MAX_SKEW_SECONDS; rate limits bound abuse.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  const [assistant] = await db()
    .select()
    .from(assistants)
    .where(eq(assistants.publicId, parsed.data.assistantId))
    .limit(1);

  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const security = SecurityPolicy.fromAssistant(assistant, env);
  if (!security.resolved.widgetSigningSecret) {
    return jsonWithCors(
      { error: "Widget signing is not configured for this assistant." },
      { status: 400 },
    );
  }

  const violation = await security.enforceWidgetRequest(request, {
    source: "widget",
    visitorId: parsed.data.visitorId,
    skipSignatureCheck: true,
  });
  if (violation) {
    return policyViolationResponse(violation);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createWidgetSignature({
    secret: security.resolved.widgetSigningSecret,
    assistantPublicId: assistant.publicId,
    visitorId: parsed.data.visitorId,
    timestamp,
  });

  return jsonWithCors({ timestamp, signature });
}
