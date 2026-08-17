import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { documents } from "@chatai/database";
import { NextResponse } from "next/server";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import { listDocumentsForAssistant } from "@/lib/documents";
import { enqueueIngest } from "@/lib/enqueue-ingest";
import { createId } from "@/lib/ids";
import { requireSession } from "@/lib/session";
import {
  ALLOWED_UPLOAD_LABEL,
  isAllowedUpload,
  MAX_UPLOAD_BYTES,
  resolveUploadDir,
  uploadPathFor,
} from "@/lib/upload";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const rows = await listDocumentsForAssistant(assistant.id);
  return NextResponse.json({ documents: rows });
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
  }

  await mkdir(resolveUploadDir(), { recursive: true });
  const created: string[] = [];

  for (const file of files) {
    if (!isAllowedUpload(file)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.name}. Use ${ALLOWED_UPLOAD_LABEL}.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `${file.name} is larger than 20 MB.` },
        { status: 400 },
      );
    }

    const documentId = createId();
    const storagePath = uploadPathFor(documentId);
    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(storagePath, bytes);

    await db().insert(documents).values({
      id: documentId,
      assistantId: assistant.id,
      type: "file",
      name: path.basename(file.name),
      mimeType: file.type || null,
      status: "pending",
      storagePath,
    });
    await enqueueIngest(documentId);
    created.push(documentId);
  }

  return NextResponse.json({ ok: true, documentIds: created });
}
