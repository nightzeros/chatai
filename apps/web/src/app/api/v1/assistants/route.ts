import { listAssistantsForUser } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { jsonWithCors } from "@/lib/cors";
import { getOrCreateHostingAccount } from "@/lib/hosting/accounts";
import { createAssistantWithLimit } from "@/lib/hosting/assistant-limits";
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
  const account = await getOrCreateHostingAccount(auth.auth.userId);
  const id = createId();

  const created = await createAssistantWithLimit({
    account,
    userId: auth.auth.userId,
    values: {
      id,
      publicId: createAssistantPublicId(),
      userId: auth.auth.userId,
      name: data.name,
      description: data.description ?? null,
      welcomeMessage: data.welcomeMessage ?? DEFAULT_WELCOME,
      instructions: data.instructions ?? DEFAULT_INSTRUCTIONS,
      hallucinationMode: data.hallucinationMode ?? "balanced",
      settings: {},
    },
  });

  if (!created.ok) {
    const err = created.error;
    return jsonWithCors(
      {
        error: err.message,
        code: err.code,
        resource: err.resource,
        current: err.current,
        limit: err.limit,
      },
      { status: 403 },
    );
  }

  await logAuditEvent({
    userId: auth.auth.userId,
    action: "assistant_created",
    resourceType: "assistant",
    resourceId: created.assistant.id,
    metadata: { name: created.assistant.name, via: "api" },
  });

  return jsonWithCors({ assistant: serializeAssistant(created.assistant) }, { status: 201 });
}
