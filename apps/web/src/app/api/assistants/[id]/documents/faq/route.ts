import { documents } from "@chatai/database";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import { enqueueIngest } from "@/lib/enqueue-ingest";
import { createId } from "@/lib/ids";
import { requireSession } from "@/lib/session";

const schema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(20_000),
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
  const content = `Question: ${parsed.data.question}\n\nAnswer: ${parsed.data.answer}`;

  await db().insert(documents).values({
    id: documentId,
    assistantId: assistant.id,
    type: "faq",
    name: parsed.data.question.slice(0, 120),
    mimeType: "text/plain",
    status: "pending",
    content,
  });
  await enqueueIngest(documentId);

  return NextResponse.json({ ok: true, documentId });
}
