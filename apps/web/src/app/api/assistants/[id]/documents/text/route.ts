import { documents } from "@chatai/database";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import { enqueueIngest } from "@/lib/enqueue-ingest";
import { createId } from "@/lib/ids";
import { requireSession } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(200_000),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await context.params;
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return NextResponse.json({ error: "Assistant not found." }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  const documentId = createId();
  await db().insert(documents).values({
    id: documentId,
    assistantId: assistant.id,
    type: "text",
    name: parsed.data.name,
    mimeType: "text/plain",
    status: "pending",
    content: parsed.data.content,
  });
  await enqueueIngest(documentId);

  return NextResponse.json({ ok: true, documentId });
}
