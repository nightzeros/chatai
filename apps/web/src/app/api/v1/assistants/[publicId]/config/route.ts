import {
  assistants,
  eq,
  resolveEffectiveVoicePersistence,
  resolveVoiceSettings,
} from "@chatai/database";

import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";
import { isVoiceServiceAvailable, recordingApplies } from "@/lib/voice";

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
      privacySettings: assistants.privacySettings,
      voiceSettings: assistants.voiceSettings,
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

  const voiceEnabled =
    resolveVoiceSettings(assistant.voiceSettings).enabled &&
    isVoiceServiceAvailable(assistant.voiceSettings);

  return jsonWithCors({
    assistantId: assistant.publicId,
    name: assistant.name,
    welcomeMessage: assistant.welcomeMessage,
    settings: assistant.settings,
    requireWidgetSigning: Boolean(assistant.securitySettings?.requireWidgetSigning),
    // Only the public switch and whether the recording disclosure applies; provider,
    // model, persistence and storage details stay server-side.
    voice: {
      enabled: voiceEnabled,
      recording: {
        consentRequired:
          voiceEnabled &&
          recordingApplies(
            resolveEffectiveVoicePersistence(assistant.privacySettings, assistant.voiceSettings),
          ),
      },
    },
  });
}
