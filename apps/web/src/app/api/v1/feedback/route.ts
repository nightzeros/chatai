import { and, assistants, conversations, eq, messages } from "@chatai/database";
import { z } from "zod";

import { canSubmitFeedback } from "@/lib/feedback-auth";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
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
      assistantOwnerId: assistants.userId,
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
