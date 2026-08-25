"use client";

import { useActionState } from "react";

import {
  updateSecurityPolicy,
  type SecurityPolicyActionState,
} from "@/app/dashboard/assistants/[id]/settings/security-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  assistantId: string;
  allowedDomains: string[];
  widgetRateLimitPerVisitor: number | null;
  widgetRateLimitPerAssistant: number | null;
  instanceVisitorLimit: number;
  instanceAssistantLimit: number;
};

export function SecurityPolicyCard({
  assistantId,
  allowedDomains,
  widgetRateLimitPerVisitor,
  widgetRateLimitPerAssistant,
  instanceVisitorLimit,
  instanceAssistantLimit,
}: Props) {
  const [state, action, pending] = useActionState<SecurityPolicyActionState, FormData>(
    updateSecurityPolicy,
    null,
  );

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Domain allowlist & rate limits</CardTitle>
        <CardDescription>
          Limit which websites can embed this assistant and how many chat requests are allowed. Empty
          allowlist means any origin is accepted. These checks run on the server for every public
          widget request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-5">
          <input type="hidden" name="id" value={assistantId} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="allowedDomains">Allowed domains</Label>
            <Textarea
              id="allowedDomains"
              name="allowedDomains"
              className="min-h-28 font-mono text-xs"
              defaultValue={allowedDomains.join("\n")}
              placeholder={"example.com\n*.vercel.app\nlocalhost"}
            />
            <p className="text-sm text-muted-foreground">
              One hostname per line (or comma-separated). Use{" "}
              <code className="text-xs">*.example.com</code> for subdomains. Do not include paths or
              protocols.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="widgetRateLimitPerVisitor">Per-visitor requests / minute</Label>
              <Input
                id="widgetRateLimitPerVisitor"
                name="widgetRateLimitPerVisitor"
                type="number"
                min={1}
                max={10000}
                placeholder={String(instanceVisitorLimit)}
                defaultValue={widgetRateLimitPerVisitor ?? ""}
              />
              <p className="text-xs text-muted-foreground">
                Blank uses instance default ({instanceVisitorLimit}).
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="widgetRateLimitPerAssistant">Per-assistant requests / minute</Label>
              <Input
                id="widgetRateLimitPerAssistant"
                name="widgetRateLimitPerAssistant"
                type="number"
                min={1}
                max={10000}
                placeholder={String(instanceAssistantLimit)}
                defaultValue={widgetRateLimitPerAssistant ?? ""}
              />
              <p className="text-xs text-muted-foreground">
                Blank uses instance default ({instanceAssistantLimit}).
              </p>
            </div>
          </div>

          <details className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Technical details</summary>
            <p className="mt-2">
              Domain checks use the request Origin/Referer hostname. Rate limits are enforced per
              visitor id and assistant before the model runs. Failed checks return a generic error to
              the widget.
            </p>
          </details>

          {state && "error" in state ? <p className="text-sm text-destructive">{state.error}</p> : null}
          {state && "saved" in state ? (
            <p className="text-sm text-muted-foreground">Security policy saved.</p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Saving…" : "Save security policy"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
