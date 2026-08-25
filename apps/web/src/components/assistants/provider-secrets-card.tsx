"use client";

import { useActionState } from "react";

import {
  updateProviderSecrets,
  type ProviderSecretsActionState,
} from "@/app/dashboard/assistants/[id]/settings/provider-secrets-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SecretMeta = {
  kind: "chat" | "embedding";
  provider: string;
  keyPrefix: string | null;
};

type Props = {
  assistantId: string;
  chatProvider: string;
  embeddingProvider: string;
  secrets: SecretMeta[];
};

function maskLabel(meta: SecretMeta | undefined) {
  if (!meta?.keyPrefix) {
    return "Not set — using instance env keys";
  }
  return `Stored for ${meta.provider} (••••${meta.keyPrefix})`;
}

export function ProviderSecretsCard({
  assistantId,
  chatProvider,
  embeddingProvider,
  secrets,
}: Props) {
  const [state, action, pending] = useActionState<ProviderSecretsActionState, FormData>(
    updateProviderSecrets,
    null,
  );

  const chat = secrets.find((s) => s.kind === "chat");
  const embedding = secrets.find((s) => s.kind === "embedding");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider API keys</CardTitle>
        <CardDescription>
          Optional per-assistant keys, encrypted at rest with{" "}
          <code className="text-xs">ENCRYPTION_KEY</code>. Keys are decrypted only on the server
          when calling providers — never returned by config or assistant APIs. Leave blank to keep
          the current key; check clear to remove.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={assistantId} />
          <input type="hidden" name="chatProvider" value={chatProvider} />
          <input type="hidden" name="embeddingProvider" value={embeddingProvider} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="chatApiKey">Chat API key</Label>
            <p className="text-xs text-muted-foreground">{maskLabel(chat)}</p>
            <Input
              id="chatApiKey"
              name="chatApiKey"
              type="password"
              autoComplete="off"
              placeholder="Paste a new key to replace"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" name="clearChatApiKey" className="rounded border" />
              Clear stored chat key
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="embeddingApiKey">Embedding API key</Label>
            <p className="text-xs text-muted-foreground">{maskLabel(embedding)}</p>
            <Input
              id="embeddingApiKey"
              name="embeddingApiKey"
              type="password"
              autoComplete="off"
              placeholder="Paste a new key to replace"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" name="clearEmbeddingApiKey" className="rounded border" />
              Clear stored embedding key
            </label>
          </div>

          {state && "error" in state ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          {state && "saved" in state ? (
            <p className="text-sm text-muted-foreground">Provider keys saved.</p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save provider keys"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
