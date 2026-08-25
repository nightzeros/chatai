"use server";

import { assistants, eq } from "@chatai/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOwnedAssistant } from "@/lib/assistants";
import { settingsFromFormData } from "@/lib/assistant-settings";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";
import { enqueueReprocessForAssistant } from "@/lib/enqueue-reprocess";
import { env } from "@/lib/env";
import { createAssistantPublicId, createId } from "@/lib/ids";
import {
  embeddingSettingsChanged,
  modelSettingsFromFormData,
  validateChatModelSettings,
  validateEmbeddingModelSettings,
} from "@/lib/model-settings";
import { requireSession } from "@/lib/session";

export type ActionState = { error: string } | { saved: true } | null;

const DEFAULT_WELCOME = "Hi! How can I help you today?";
const DEFAULT_INSTRUCTIONS =
  "You are a helpful AI assistant. Answer questions using the supplied knowledge base. Do not make up information.";

const hallucinationModeSchema = z.enum(["strict", "balanced", "flexible"]);

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(8000).optional(),
});

const updateSchema = createSchema.extend({
  id: z.string().min(1),
  hallucinationMode: hallucinationModeSchema,
  chunkingMode: z.enum(["standard", "parent_child"]),
  hybridSearch: z.boolean(),
  rerank: z.boolean(),
  queryExpansion: z.boolean(),
  requireContext: z.boolean(),
  verifyCitations: z.boolean(),
  refuseOnLowConfidence: z.boolean(),
  evalSampleRate: z.coerce.number().min(0).max(1),
});

function emptyToUndefined(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export async function createAssistant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    description: emptyToUndefined(formData.get("description")),
    welcomeMessage: emptyToUndefined(formData.get("welcomeMessage")),
    instructions: emptyToUndefined(formData.get("instructions")),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const id = createId();

  await db().insert(assistants).values({
    id,
    publicId: createAssistantPublicId(),
    userId: session.user.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    welcomeMessage: parsed.data.welcomeMessage ?? DEFAULT_WELCOME,
    instructions: parsed.data.instructions ?? DEFAULT_INSTRUCTIONS,
    hallucinationMode: "balanced",
    settings: {},
  });

  await logAuditEvent({
    userId: session.user.id,
    action: "assistant_created",
    resourceType: "assistant",
    resourceId: id,
    metadata: { name: parsed.data.name },
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard/assistants/${id}`);
}

export async function updateAssistant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    description: emptyToUndefined(formData.get("description")),
    welcomeMessage: emptyToUndefined(formData.get("welcomeMessage")),
    instructions: emptyToUndefined(formData.get("instructions")),
    hallucinationMode: formData.get("hallucinationMode"),
    chunkingMode: formData.get("chunkingMode"),
    hybridSearch: formData.get("hybridSearch") === "on",
    rerank: formData.get("rerank") === "on",
    queryExpansion: formData.get("queryExpansion") === "on",
    requireContext: formData.get("requireContext") === "on",
    verifyCitations: formData.get("verifyCitations") === "on",
    refuseOnLowConfidence: formData.get("refuseOnLowConfidence") === "on",
    evalSampleRate: formData.get("evalSampleRate") ?? 0,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await getOwnedAssistant(session.user.id, parsed.data.id);
  if (!existing) {
    return { error: "Assistant not found." };
  }

  const modelSettings = modelSettingsFromFormData(formData);
  const instanceEmbedding = {
    provider: env.EMBEDDING_PROVIDER ?? "openai",
    model: env.EMBEDDING_MODEL,
  };

  const chatError = validateChatModelSettings(modelSettings);
  if (chatError) {
    return { error: chatError };
  }

  const embeddingError = validateEmbeddingModelSettings(
    modelSettings,
    env.EMBEDDING_DIMENSIONS,
    instanceEmbedding,
  );
  if (embeddingError) {
    return { error: embeddingError };
  }

  const shouldReprocess = embeddingSettingsChanged(
    existing.modelSettings,
    modelSettings,
    instanceEmbedding,
  );

  await db()
    .update(assistants)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      welcomeMessage: parsed.data.welcomeMessage ?? DEFAULT_WELCOME,
      instructions: parsed.data.instructions ?? DEFAULT_INSTRUCTIONS,
      hallucinationMode: parsed.data.hallucinationMode,
      ragSettings: {
        ...existing.ragSettings,
        chunkingMode: parsed.data.chunkingMode,
        hybridSearch: parsed.data.hybridSearch,
        rerank: parsed.data.rerank,
        queryExpansion: parsed.data.queryExpansion,
        evalSampleRate: parsed.data.evalSampleRate,
        guardrails: {
          ...existing.ragSettings?.guardrails,
          requireContext: parsed.data.requireContext,
          verifyCitations: parsed.data.verifyCitations,
          refuseOnLowConfidence: parsed.data.refuseOnLowConfidence,
        },
      },
      modelSettings,

      updatedAt: new Date(),
    })
    .where(eq(assistants.id, existing.id));

  if (shouldReprocess) {
    await enqueueReprocessForAssistant(existing.id);
  }

  await logAuditEvent({
    userId: session.user.id,
    action: "assistant_settings_updated",
    resourceType: "assistant",
    resourceId: existing.id,
    metadata: { fields: ["settings", "rag", "models"] },
  });

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/assistants/${existing.id}`);
  return { saved: true };
}

export async function updateAssistantSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");

  const existing = await getOwnedAssistant(session.user.id, id);
  if (!existing) {
    return { error: "Assistant not found." };
  }

  try {
    const settings = settingsFromFormData(formData);
    await db()
      .update(assistants)
      .set({
        settings: { ...existing.settings, ...settings },
        updatedAt: new Date(),
      })
      .where(eq(assistants.id, existing.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "Invalid widget settings." };
    }
    throw error;
  }

  revalidatePath(`/dashboard/assistants/${existing.id}`);
  revalidatePath(`/dashboard/assistants/${existing.id}/customize`);
  revalidatePath(`/dashboard/assistants/${existing.id}/install`);
  return { saved: true };
}

export async function deleteAssistant(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");

  const existing = await getOwnedAssistant(session.user.id, id);
  if (!existing) {
    throw new Error("Assistant not found.");
  }

  await db().delete(assistants).where(eq(assistants.id, existing.id));

  await logAuditEvent({
    userId: session.user.id,
    action: "assistant_deleted",
    resourceType: "assistant",
    resourceId: existing.id,
    metadata: { name: existing.name, publicId: existing.publicId },
  });

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
