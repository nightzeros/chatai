"use server";

import { assistants, eq, type PrivacyRetentionDays } from "@chatai/database";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getOwnedAssistant } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";

export type PrivacySettingsActionState = { error: string } | { saved: true } | null;

const retentionSchema = z.union([z.literal("off"), z.literal(7), z.literal(30), z.literal(90)]);

export async function updatePrivacySettings(
  _prev: PrivacySettingsActionState,
  formData: FormData,
): Promise<PrivacySettingsActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return { error: "Assistant not found." };
  }

  const storeConversations = formData.get("storeConversations") === "on";
  const anonymizeVisitorIds = formData.get("anonymizeVisitorIds") === "on";
  const retentionRaw = String(formData.get("retentionDays") ?? "90");
  const retentionParsed =
    retentionRaw === "off"
      ? retentionSchema.safeParse("off")
      : retentionSchema.safeParse(Number(retentionRaw));

  if (!retentionParsed.success) {
    return { error: "Invalid retention setting." };
  }

  const retentionDays = retentionParsed.data as PrivacyRetentionDays;
  const next = {
    ...(assistant.privacySettings ?? {}),
    storeConversations,
    retentionDays,
    anonymizeVisitorIds,
  };

  await db()
    .update(assistants)
    .set({
      privacySettings: next,
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, assistant.id));

  await logAuditEvent({
    userId: session.user.id,
    action: "privacy_settings_updated",
    resourceType: "assistant",
    resourceId: assistant.id,
    metadata: {
      storeConversations,
      retentionDays,
      anonymizeVisitorIds,
    },
  });

  revalidatePath(`/dashboard/assistants/${assistant.id}/settings`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/conversations`);
  return { saved: true };
}
