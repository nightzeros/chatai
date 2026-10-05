import { unlink } from "node:fs/promises";

import { documents, eq } from "@chatai/database";

import { getOwnedAssistantByRef } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { getOwnedDocument } from "@/lib/documents";
import { onKnowledgeChanged } from "@/lib/profile/jobs";
import { serializeDocument } from "@/lib/rest-serialize";
import { isV1Error, requireV1, v1Options } from "@/lib/v1";

type RouteContext = { params: Promise<{ publicId: string; documentId: string }> };

export async function OPTIONS() {
  return v1Options();
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireV1(request, ["documents:read"]);
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

  return jsonWithCors({ document: serializeDocument(document) });
}

export async function DELETE(request: Request, context: RouteContext) {
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

  await db().delete(documents).where(eq(documents.id, document.id));
  if (document.storagePath) {
    await unlink(document.storagePath).catch(() => undefined);
  }

  await logAuditEvent({
    userId: auth.auth.userId,
    action: "document_deleted",
    resourceType: "document",
    resourceId: document.id,
    metadata: {
      assistantId: assistant.id,
      name: document.name,
      type: document.type,
      via: "api",
    },
  });
  await onKnowledgeChanged(db(), assistant.id);

  return jsonWithCors({ ok: true });
}
