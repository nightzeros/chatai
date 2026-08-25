import { assistants, eq } from "@chatai/database";

import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await context.params;
  const [assistant] = await db()
    .select({
      id: assistants.id,
      publicId: assistants.publicId,
      name: assistants.name,
      welcomeMessage: assistants.welcomeMessage,
      settings: assistants.settings,
      securitySettings: assistants.securitySettings,
    })
    .from(assistants)
    .where(eq(assistants.publicId, publicId))
    .limit(1);

  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const security = SecurityPolicy.fromAssistant(assistant, env);
  const violation = await security.enforceWidgetRequest(request, { source: "widget" });
  if (violation) {
    return policyViolationResponse(violation);
  }

  return jsonWithCors({
    assistantId: assistant.publicId,
    name: assistant.name,
    welcomeMessage: assistant.welcomeMessage,
    settings: assistant.settings,
    requireWidgetSigning: Boolean(assistant.securitySettings?.requireWidgetSigning),
  });
}
