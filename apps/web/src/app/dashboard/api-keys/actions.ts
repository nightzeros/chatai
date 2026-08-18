"use server";

import { API_KEY_SCOPES, apiKeys, and, eq, type ApiKeyScope } from "@chatai/database";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateApiKeySecret, hashApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { createId } from "@/lib/ids";
import { requireSession } from "@/lib/session";

export type ApiKeyActionState =
  | { error: string }
  | { created: { name: string; secret: string; prefix: string } }
  | { revoked: true }
  | null;

const scopeSchema = z.enum(API_KEY_SCOPES);

const createSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  scopes: z.array(scopeSchema).min(1, "Select at least one scope."),
});

function scopesFromFormData(formData: FormData): ApiKeyScope[] {
  return formData
    .getAll("scopes")
    .flatMap((value) => (typeof value === "string" ? [scopeSchema.safeParse(value)] : []))
    .flatMap((result) => (result.success ? [result.data] : []));
}

export async function createApiKey(_prev: ApiKeyActionState, formData: FormData): Promise<ApiKeyActionState> {
  const session = await requireSession();

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    scopes: scopesFromFormData(formData),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { secret, prefix } = generateApiKeySecret();

  await db().insert(apiKeys).values({
    id: createId(),
    userId: session.user.id,
    name: parsed.data.name,
    keyPrefix: prefix,
    keyHash: hashApiKey(secret),
    scopes: parsed.data.scopes,
  });

  revalidatePath("/dashboard/account");
  return { created: { name: parsed.data.name, secret, prefix } };
}

export async function revokeApiKey(_prev: ApiKeyActionState, formData: FormData): Promise<ApiKeyActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { error: "API key not found." };
  }

  const [key] = await db()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, session.user.id)))
    .limit(1);

  if (!key) {
    return { error: "API key not found." };
  }

  if (key.revokedAt) {
    return { error: "API key is already revoked." };
  }

  await db()
    .update(apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(apiKeys.id, key.id));

  revalidatePath("/dashboard/account");
  return { revoked: true };
}
