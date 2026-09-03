import { assistants } from "@chatai/database";

import { getOwnedAssistantByRef, listAssistantsForUser } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { getOrCreateHostingAccount } from "@/lib/hosting/accounts";
import { createAssistantPublicId, createId } from "@/lib/ids";
import {
  assistantCreateSchema,
  DEFAULT_INSTRUCTIONS,
  DEFAULT_WELCOME,
  normalizeAssistantWrite,
} from "@/lib/rest-assistants";
import { serializeAssistant } from "@/lib/rest-serialize";
import { isV1Error, requireV1, v1Options } from "@/lib/v1";

export async function OPTIONS() {
  return v1Options();
}

export async function GET(request: Request) {
  const auth = await requireV1(request, ["assistants:read"]);
  if (isV1Error(auth)) return auth;

  const rows = await listAssistantsForUser(auth.auth.userId);
  return jsonWithCors({ assistants: rows.map(serializeAssistant) });
}

export async function POST(request: Request) {
  const auth = await requireV1(request, ["assistants:write"]);
  if (isV1Error(auth)) return auth;

  const parsed = assistantCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors({ error: parsed.error.issues[0]?.message ?? "Invalid request body." }, { status: 400 });
  }

  const data = normalizeAssistantWrite(parsed.data);
  await getOrCreateHostingAccount(auth.auth.userId);

  const id = createId();

  const [created] = await db()
    .insert(assistants)
    .values({
      id,
      publicId: createAssistantPublicId(),
      userId: auth.auth.userId,
      name: data.name,
      description: data.description ?? null,
      welcomeMessage: data.welcomeMessage ?? DEFAULT_WELCOME,
      instructions: data.instructions ?? DEFAULT_INSTRUCTIONS,
      hallucinationMode: data.hallucinationMode ?? "balanced",
      settings: {},
    })
    .returning();

  if (!created) {
    const assistant = await getOwnedAssistantByRef(auth.auth.userId, id);
    if (!assistant) {
      return jsonWithCors({ error: "Could not create assistant." }, { status: 500 });
    }
    await logAuditEvent({
      userId: auth.auth.userId,
      action: "assistant_created",
      resourceType: "assistant",
      resourceId: assistant.id,
      metadata: { name: assistant.name, via: "api" },
    });
    return jsonWithCors({ assistant: serializeAssistant(assistant) }, { status: 201 });
  }

  await logAuditEvent({
    userId: auth.auth.userId,
    action: "assistant_created",
    resourceType: "assistant",
    resourceId: created.id,
    metadata: { name: created.name, via: "api" },
  });

  return jsonWithCors({ assistant: serializeAssistant(created) }, { status: 201 });
}
