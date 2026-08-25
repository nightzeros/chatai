import { and, assistants, conversations, eq, messages } from "@chatai/database";
import { z } from "zod";

import { canSubmitFeedback } from "@/lib/feedback-auth";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  messageId: z.string().min(1, "messageId is required"),
  rating: z.enum(["positive", "negative"]),
  visitorId: z.string().min(1).max(80).optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  const [message] = await db()
    .select({
      id: messages.id,
      role: messages.role,
      conversationVisitorId: conversations.visitorId,
      conversationSource: conversations.source,
      assistantId: assistants.id,
      assistantPublicId: assistants.publicId,
      assistantOwnerId: assistants.userId,
      securitySettings: assistants.securitySettings,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(assistants, eq(conversations.assistantId, assistants.id))
    .where(eq(messages.id, parsed.data.messageId))
    .limit(1);

  if (!message) {
    return jsonWithCors({ error: "Message not found." }, { status: 404 });
  }

  const session = await getSession();
  const isOwner = session?.user.id === message.assistantOwnerId;

  // Owner playground ratings skip domain checks; widget/public feedback enforce allowlist.
  if (!isOwner) {
    const security = SecurityPolicy.fromAssistant(
      {
        id: message.assistantId,
        publicId: message.assistantPublicId,
        securitySettings: message.securitySettings,
      },
      env,
    );
    const violation = await security.enforceWidgetRequest(request, {
      visitorId: parsed.data.visitorId,
      source: message.conversationSource === "playground" ? "playground" : "widget",
    });
    if (violation) {
      return policyViolationResponse(violation);
    }
  }

  if (
    !canSubmitFeedback({
      messageRole: message.role,
      conversationVisitorId: message.conversationVisitorId,
      providedVisitorId: parsed.data.visitorId,
      assistantOwnerId: message.assistantOwnerId,
      sessionUserId: session?.user.id,
    })
  ) {
    return jsonWithCors({ error: "Not authorized to rate this message." }, { status: 403 });
  }

  await db()
    .update(messages)
    .set({ feedback: parsed.data.rating })
    .where(and(eq(messages.id, message.id), eq(messages.role, "assistant")));

  return jsonWithCors({ ok: true, feedback: parsed.data.rating });
}
