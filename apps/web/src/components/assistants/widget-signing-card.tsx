"use client";

import { useActionState } from "react";

import {
  updateWidgetSigning,
  type WidgetSigningActionState,
} from "@/app/dashboard/assistants/[id]/settings/widget-signing-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Props = {
  assistantId: string;
  requireWidgetSigning: boolean;
  hasSigningSecret: boolean;
};

export function WidgetSigningCard({
  assistantId,
  requireWidgetSigning,
  hasSigningSecret,
}: Props) {
  const [state, action, pending] = useActionState<WidgetSigningActionState, FormData>(
    updateWidgetSigning,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Widget signing</CardTitle>
        <CardDescription>
          When enabled, public widget chat must present a short-lived HMAC from{" "}
          <code className="text-xs">/api/v1/widget/sign</code>. This is one layer alongside domain
          allowlists, rate limits, and bot checks — not proof of request origin (headers can be
          spoofed outside a browser).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={assistantId} />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="requireWidgetSigning"
              defaultChecked={requireWidgetSigning}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Require widget signing</span>
              <span className="mt-1 block text-muted-foreground">
                {hasSigningSecret
                  ? "A signing secret is already stored. Disabling keeps the secret so you can re-enable without rotating."
                  : "Enabling generates a new signing secret (shown once below)."}
              </span>
            </span>
          </label>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save signing settings"}
            </Button>
          </div>
        </form>

        {state && "error" in state ? (
          <p className="text-sm text-destructive">{state.error}</p>
        ) : null}
        {state && "saved" in state ? (
          <p className="text-sm text-muted-foreground">Signing settings saved.</p>
        ) : null}
        {state && "revealedSecret" in state && state.revealedSecret ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Signing secret (copy now — not shown again)
            </Label>
            <p className="mt-2 break-all font-mono text-xs">{state.revealedSecret}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
