import { getOwnedAssistantByRef } from "@/lib/assistants";
import { jsonWithCors } from "@/lib/cors";
import { getOwnedDocument } from "@/lib/documents";
import { reprocessDocument } from "@/lib/enqueue-reprocess";
import { isV1Error, requireV1, v1Options } from "@/lib/v1";

export async function OPTIONS() {
  return v1Options();
}

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string; documentId: string }> },
) {
  const auth = await requireV1(request, ["documents:write"]);
  if (isV1Error(auth)) return auth;

  const { publicId, documentId } = await context.params;
  const assistant = await getOwnedAssistantByRef(auth.auth.userId, publicId);
  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const document = await getOwnedDocument(auth.auth.userId, assistant.id, documentId);
  if (!document) {
    return jsonWithCors({ error: "Document not found." }, { status: 404 });
  }

  await reprocessDocument(document.id);
  return jsonWithCors({ ok: true });
}
