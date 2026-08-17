"use server";

import { assistants, eq } from "@chatai/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getOwnedAssistant } from "@/lib/assistants";
import { settingsFromFormData } from "@/lib/assistant-settings";
import { db } from "@/lib/db";
import { createAssistantPublicId, createId } from "@/lib/ids";
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
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const existing = await getOwnedAssistant(session.user.id, parsed.data.id);
  if (!existing) {
    return { error: "Assistant not found." };
  }

  await db()
    .update(assistants)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      welcomeMessage: parsed.data.welcomeMessage ?? DEFAULT_WELCOME,
      instructions: parsed.data.instructions ?? DEFAULT_INSTRUCTIONS,
      hallucinationMode: parsed.data.hallucinationMode,
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, existing.id));

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

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
