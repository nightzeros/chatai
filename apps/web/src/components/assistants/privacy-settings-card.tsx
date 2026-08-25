"use client";

import { useActionState } from "react";

import {
  updatePrivacySettings,
  type PrivacySettingsActionState,
} from "@/app/dashboard/assistants/[id]/settings/privacy-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  assistantId: string;
  storeConversations: boolean;
  retentionDays: "off" | 7 | 30 | 90;
  anonymizeVisitorIds: boolean;
};

const RETENTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "off", label: "No automatic deletion" },
];

export function PrivacySettingsCard({
  assistantId,
  storeConversations,
  retentionDays,
  anonymizeVisitorIds,
}: Props) {
  const [state, action, pending] = useActionState<PrivacySettingsActionState, FormData>(
    updatePrivacySettings,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
        <CardDescription>
          Control whether public visitor chats are stored, how long they are kept, and whether
          visitor identifiers are cleared on older conversations. Owner playground chats continue
          to be stored for debugging.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-5">
          <input type="hidden" name="id" value={assistantId} />

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="storeConversations"
              defaultChecked={storeConversations}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Store visitor conversations</span>
              <span className="mt-1 block text-muted-foreground">
                When disabled, public visitor conversations are not saved after the response is
                generated. Answers still stream normally; feedback and conversation analytics that
                depend on stored transcripts will not include those chats.
              </span>
            </span>
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Retention</legend>
            <p className="text-sm text-muted-foreground">
              Automatically delete stored conversations older than the selected window.
            </p>
            {RETENTION_OPTIONS.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="retentionDays"
                  value={option.value}
                  defaultChecked={String(retentionDays) === option.value}
                />
                {option.label}
              </label>
            ))}
          </fieldset>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="anonymizeVisitorIds"
              defaultChecked={anonymizeVisitorIds}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Anonymize visitor identifiers</span>
              <span className="mt-1 block text-muted-foreground">
                Clears the stored visitorId on conversations older than min(30 days, retention
                window), so older transcripts can no longer be linked to the original visitor
                token. Message content is not rewritten. Idempotent if run again.
              </span>
            </span>
          </label>

          {state && "error" in state ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          {state && "saved" in state ? (
            <p className="text-sm text-muted-foreground">Privacy settings saved.</p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save privacy settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
