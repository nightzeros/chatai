"use client";

import { useActionState } from "react";

import {
  updateVoiceSettings,
  type VoiceSettingsActionState,
} from "@/app/dashboard/assistants/[id]/settings/voice-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  assistantId: string;
  enabled: boolean;
  saveTranscripts: boolean;
  /** The instance has a Voice provider configured. */
  serviceAvailable: boolean;
  /** Global storage is off: Voice is always ephemeral. */
  storeConversations: boolean;
  saveAudioRecordings: boolean;
  recordingRetentionDays: "off" | 7 | 30 | 90;
  /** S3-compatible object storage is configured on this instance. */
  objectStorageAvailable: boolean;
  conversationRetentionDays: "off" | 7 | 30 | 90;
};

const RECORDING_RETENTION_OPTIONS = [
  { value: "off", label: "Keep while the conversation is kept" },
  { value: "7", label: "Delete after 7 days" },
  { value: "30", label: "Delete after 30 days" },
  { value: "90", label: "Delete after 90 days" },
] as const;

export function VoiceSettingsCard({
  assistantId,
  enabled,
  saveTranscripts,
  serviceAvailable,
  storeConversations,
  saveAudioRecordings,
  recordingRetentionDays,
  objectStorageAvailable,
  conversationRetentionDays,
}: Props) {
  const recordingAllowed = storeConversations && objectStorageAvailable;
  const [state, action, pending] = useActionState<VoiceSettingsActionState, FormData>(
    updateVoiceSettings,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice</CardTitle>
        <CardDescription>
          Let visitors talk to this assistant from the embedded widget. Voice answers use the same
          knowledge, conversation history and security rules as text chat. You can always test
          Voice in the playground.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-5">
          <input type="hidden" name="id" value={assistantId} />

          {!serviceAvailable ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              Voice is not configured on this instance (set VOICE_OPENAI_API_KEY on the server). The
              widget will not offer Voice until it is.
            </p>
          ) : null}

          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="voiceEnabled" defaultChecked={enabled} className="mt-1" />
            <span>
              <span className="font-medium">Offer Voice in the public widget</span>
              <span className="mt-1 block text-muted-foreground">
                Shows a microphone button in the widget. Voice sessions follow your domain
                allowlist, widget signing and rate limits.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="saveTranscripts"
              defaultChecked={saveTranscripts}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Save Voice transcripts (text only)</span>
              <span className="mt-1 block text-muted-foreground">
                {storeConversations
                  ? "Saves the text of what was said in Voice as messages in the conversation, so it appears in Conversations and later text chat can refer to it. When off, Voice turns are used only during the live session and discarded when it ends. This setting never records audio."
                  : "Conversation storage is off in Privacy, so Voice stays ephemeral and nothing is saved regardless of this setting. Audio is never recorded."}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="saveAudioRecordings"
              defaultChecked={saveAudioRecordings && recordingAllowed}
              disabled={!recordingAllowed}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Record Voice audio</span>
              <span className="mt-1 block text-muted-foreground">
                {!storeConversations
                  ? "Conversation storage is off in Privacy, so Voice audio is never recorded."
                  : !objectStorageAvailable
                    ? "Recording is not configured on this instance (set the OBJECT_STORAGE_* variables on the server). Voice works normally without it."
                    : "Saves one audio recording per Voice session to this conversation for you to play back. Visitors must agree to a recording notice before their microphone turns on. Independent of Voice transcripts. Off by default."}
              </span>
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Recording retention</span>
            <select
              name="recordingRetentionDays"
              defaultValue={String(recordingRetentionDays)}
              disabled={!recordingAllowed}
              className="h-9 w-fit rounded-md border border-input bg-background px-3 text-sm"
            >
              {RECORDING_RETENTION_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={
                    option.value !== "off" &&
                    conversationRetentionDays !== "off" &&
                    Number(option.value) > conversationRetentionDays
                  }
                >
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">
              Recordings are always deleted with their conversation
              {conversationRetentionDays !== "off"
                ? ` (conversation retention: ${conversationRetentionDays} days)`
                : ""}
              .
            </span>
          </label>
          {!recordingAllowed ? (
            <input type="hidden" name="recordingRetentionDays" value={String(recordingRetentionDays)} />
          ) : null}

          {state && "error" in state ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          {state && "saved" in state ? (
            <p className="text-sm text-muted-foreground">Voice settings saved.</p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save Voice settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
