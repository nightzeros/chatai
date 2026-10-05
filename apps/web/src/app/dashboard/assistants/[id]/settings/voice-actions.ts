"use server";

import { assistants, defaultPrivacySettings, eq } from "@chatai/database";
import { revalidatePath } from "next/cache";

import { getOwnedAssistant } from "@/lib/assistants";
import { logAuditEvent } from "@/lib/audit/log-audit-event";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { isObjectStorageAvailable } from "@/lib/storage/object-storage";
import { validateRecordingSettings } from "@/lib/voice/recording/settings";

export type VoiceSettingsActionState = { error: string } | { saved: true } | null;

export async function updateVoiceSettings(
  _prev: VoiceSettingsActionState,
  formData: FormData,
): Promise<VoiceSettingsActionState> {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const assistant = await getOwnedAssistant(session.user.id, id);
  if (!assistant) {
    return { error: "Assistant not found." };
  }

  const enabled = formData.get("voiceEnabled") === "on";
  const saveTranscripts = formData.get("saveTranscripts") === "on";
  const privacy = { ...defaultPrivacySettings, ...(assistant.privacySettings ?? {}) };
  const recording = validateRecordingSettings({
    saveAudioRecordings: formData.get("saveAudioRecordings") === "on",
    recordingRetention: String(formData.get("recordingRetentionDays") ?? "off"),
    storeConversations: privacy.storeConversations,
    objectStorageAvailable: isObjectStorageAvailable(),
    conversationRetentionDays: privacy.retentionDays,
  });
  if (!recording.ok) {
    return { error: recording.error };
  }

  await db()
    .update(assistants)
    .set({
      voiceSettings: {
        ...(assistant.voiceSettings ?? {}),
        enabled,
        saveTranscripts,
        ...recording.value,
      },
      updatedAt: new Date(),
    })
    .where(eq(assistants.id, assistant.id));

  await logAuditEvent({
    userId: session.user.id,
    action: "voice_settings_updated",
    resourceType: "assistant",
    resourceId: assistant.id,
    metadata: { enabled, saveTranscripts, ...recording.value },
  });

  revalidatePath(`/dashboard/assistants/${assistant.id}/settings/privacy`);
  revalidatePath(`/dashboard/assistants/${assistant.id}/playground`);
  return { saved: true };
}
