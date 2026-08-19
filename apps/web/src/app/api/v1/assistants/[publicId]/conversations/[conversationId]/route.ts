import { getOwnedAssistantByRef } from "@/lib/assistants";
import { jsonWithCors } from "@/lib/cors";
import { getOwnedConversationTranscript } from "@/lib/conversations";
import { isV1Error, requireV1, v1Options } from "@/lib/v1";

export async function OPTIONS() {
  return v1Options();
}

export async function GET(
  request: Request,
  context: { params: Promise<{ publicId: string; conversationId: string }> },
) {
  const auth = await requireV1(request, ["conversations:read"]);
  if (isV1Error(auth)) return auth;

  const { publicId, conversationId } = await context.params;
  const assistant = await getOwnedAssistantByRef(auth.auth.userId, publicId);
  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const transcript = await getOwnedConversationTranscript(
    auth.auth.userId,
    assistant.id,
    conversationId,
  );
  if (!transcript) {
    return jsonWithCors({ error: "Conversation not found." }, { status: 404 });
  }

  return jsonWithCors(transcript);
}
