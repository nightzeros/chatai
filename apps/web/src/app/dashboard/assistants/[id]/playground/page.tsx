import { resolveEffectiveVoicePersistence, resolveVoiceSettings } from "@chatai/database";
import { notFound } from "next/navigation";

import { PlaygroundChat } from "@/components/playground/playground-chat";
import { getOwnedAssistant } from "@/lib/assistants";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { isVoiceServiceAvailable, recordingApplies, resolveVoiceProviderKind } from "@/lib/voice";

export default async function PlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  const assistant = await getOwnedAssistant(session.user.id, id);

  if (!assistant) {
    notFound();
  }

  const providerKind = resolveVoiceProviderKind(env.VOICE_PROVIDER);
  const voiceConfigured = isVoiceServiceAvailable(assistant.voiceSettings);
  const persistence = resolveEffectiveVoicePersistence(
    assistant.privacySettings,
    assistant.voiceSettings,
  );

  return (
    <PlaygroundChat
      publicId={assistant.publicId}
      name={assistant.name}
      welcomeMessage={assistant.welcomeMessage}
      voice={{
        assistantId: assistant.id,
        available: voiceConfigured,
        mockProvider: providerKind === "mock",
        publicEnabled: resolveVoiceSettings(assistant.voiceSettings).enabled,
        ephemeral: persistence.ephemeral,
        saveTranscripts: persistence.saveTranscripts,
        recording: recordingApplies(persistence),
      }}
    />
  );
}
