"use client";

import { useActionState } from "react";
import { API_KEY_SCOPES, type ApiKeyScope } from "@chatai/database/api-key-scopes";

import {
  createApiKey,
  revokeApiKey,
} from "@/app/dashboard/api-keys/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  chat: "Chat",
  "assistants:read": "Assistants (read)",
  "assistants:write": "Assistants (write)",
  "documents:read": "Documents (read)",
  "documents:write": "Documents (write)",
  "conversations:read": "Conversations (read)",
  "analytics:read": "Analytics (read)",
};

function formatDate(value: Date | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function ApiKeysPanel({ keys }: { keys: ApiKeyRow[] }) {
  const [createState, createAction, createPending] = useActionState(createApiKey, null);
  const [revokeState, revokeAction, revokePending] = useActionState(revokeApiKey, null);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Create Bearer tokens for the public REST API. Keys are shown once at creation — store
            them securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form action={createAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="apiKeyName">Name</Label>
              <Input id="apiKeyName" name="name" required maxLength={80} placeholder="Production SDK" />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Scopes</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {API_KEY_SCOPES.map((scope) => (
                  <label key={scope} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" name="scopes" value={scope} className="rounded border-input" />
                    <span>{SCOPE_LABELS[scope]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {createState && "error" in createState ? (
              <p className="text-sm text-destructive">{createState.error}</p>
            ) : null}
            <Button type="submit" disabled={createPending} className="w-fit">
              {createPending ? "Creating…" : "Create API key"}
            </Button>
          </form>

          {createState && "created" in createState ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
              <p className="text-sm font-medium">Copy your new API key now</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This is the only time the full secret for “{createState.created.name}” will be shown.
              </p>
              <code className="mt-3 block overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
                {createState.created.secret}
              </code>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {revokeState && "error" in revokeState ? (
            <p className="text-sm text-destructive">{revokeState.error}</p>
          ) : null}
          {revokeState && "revoked" in revokeState ? (
            <p className="text-sm text-muted-foreground">API key revoked.</p>
          ) : null}
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            keys.map((key) => (
              <div key={key.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{key.name}</p>
                    <p className="font-mono text-sm text-muted-foreground">{key.keyPrefix}…</p>
                  </div>
                  {key.revokedAt ? (
                    <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      Revoked
                    </span>
                  ) : (
                    <form action={revokeAction}>
                      <input type="hidden" name="id" value={key.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={revokePending}
                        onClick={(event) => {
                          if (!window.confirm(`Revoke “${key.name}”?`)) {
                            event.preventDefault();
                          }
                        }}
                      >
                        Revoke
                      </Button>
                    </form>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Scopes: {key.scopes.map((scope) => SCOPE_LABELS[scope]).join(", ")}
                </p>
                <p className="text-sm text-muted-foreground">
                  Created {formatDate(key.createdAt)} · Last used {formatDate(key.lastUsedAt)}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
