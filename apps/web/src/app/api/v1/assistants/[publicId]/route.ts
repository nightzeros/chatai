import { assistants, eq } from "@chatai/database";

import { getOwnedAssistantByRef } from "@/lib/assistants";
import { jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { assistantPatchSchema, normalizeAssistantWrite } from "@/lib/rest-assistants";
import { serializeAssistant } from "@/lib/rest-serialize";
import { isV1Error, requireV1, v1Options } from "@/lib/v1";

type RouteContext = { params: Promise<{ publicId: string }> };

export async function OPTIONS() {
  return v1Options();
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireV1(request, ["assistants:read"]);
  if (isV1Error(auth)) return auth;

  const { publicId } = await context.params;
  const assistant = await getOwnedAssistantByRef(auth.auth.userId, publicId);
  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  return jsonWithCors({ assistant: serializeAssistant(assistant) });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireV1(request, ["assistants:write"]);
  if (isV1Error(auth)) return auth;

  const { publicId } = await context.params;
  const existing = await getOwnedAssistantByRef(auth.auth.userId, publicId);
  if (!existing) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  const parsed = assistantPatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  const data = normalizeAssistantWrite(parsed.data);
  const [updated] = await db()
    .update(assistants)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.welcomeMessage !== undefined ? { welcomeMessage: data.welcomeMessage } : {}),
      ...(data.instructions !== undefined ? { instructions: data.instructions } : {}),
      ...(data.hallucinationMode !== undefined ? { hallucinationMode: data.hallucinationMode } : {}),
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, existing.id))
    .returning();

  const assistant = updated ?? (await getOwnedAssistantByRef(auth.auth.userId, existing.id));
  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  return jsonWithCors({ assistant: serializeAssistant(assistant) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireV1(request, ["assistants:write"]);
  if (isV1Error(auth)) return auth;

  const { publicId } = await context.params;
  const existing = await getOwnedAssistantByRef(auth.auth.userId, publicId);
  if (!existing) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  await db().delete(assistants).where(eq(assistants.id, existing.id));
  return jsonWithCors({ ok: true });
}
