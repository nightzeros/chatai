import { and, assistants, desc, eq } from "@chatai/database";

import { db } from "@/lib/db";

export type Assistant = typeof assistants.$inferSelect;

export async function listAssistantsForUser(userId: string) {
  return db()
    .select()
    .from(assistants)
    .where(eq(assistants.userId, userId))
    .orderBy(desc(assistants.updatedAt));
}

export async function getOwnedAssistant(userId: string, assistantId: string) {
  const [assistant] = await db()
    .select()
    .from(assistants)
    .where(and(eq(assistants.id, assistantId), eq(assistants.userId, userId)))
    .limit(1);

  return assistant ?? null;
}

export async function getOwnedAssistantByPublicId(userId: string, publicId: string) {
  const [assistant] = await db()
    .select()
    .from(assistants)
    .where(and(eq(assistants.publicId, publicId), eq(assistants.userId, userId)))
    .limit(1);

  return assistant ?? null;
}

/** Resolve an owned assistant by internal id or public id. */
export async function getOwnedAssistantByRef(userId: string, ref: string) {
  return (await getOwnedAssistant(userId, ref)) ?? (await getOwnedAssistantByPublicId(userId, ref));
}
