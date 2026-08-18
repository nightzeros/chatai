import { getOwnedAssistantByRef } from "@/lib/assistants";
import { jsonWithCors } from "@/lib/cors";
import { listDocumentsForAssistant } from "@/lib/documents";
import { serializeDocument } from "@/lib/rest-serialize";
import { isV1Error, requireV1, v1Options } from "@/lib/v1";

export async function OPTIONS() {
  return v1Options();
}

export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) {
  const auth = await requireV1(request, ["documents:read"]);
  if (isV1Error(auth)) return auth;

  const { publicId } = await context.params;
  const assistant = await getOwnedAssistantByRef(auth.auth.userId, publicId);
  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const rows = await listDocumentsForAssistant(assistant.id);
  return jsonWithCors({ documents: rows.map(serializeDocument) });
}
