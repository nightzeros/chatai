"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import type { InstallSnippets } from "@/lib/install-snippets";

export function InstallSnippetsPanel({
  snippets,
  requireWidgetSigning,
}: {
  snippets: InstallSnippets;
  requireWidgetSigning?: boolean;
}) {
  const [done, setDone] = useState(false);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Install"
        description="Copy the snippet, paste it before </body>, then open your site and confirm the launcher appears."
      />

      <Alert variant="info">
        <AlertTitle>Copy → Paste → Done</AlertTitle>
        <AlertDescription>
          Public ID <span className="font-mono">{snippets.publicId}</span>. {snippets.securityNote}
        </AlertDescription>
      </Alert>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Hosted script</CardTitle>
          <CardDescription>Primary install path for most sites.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CodeBlock code={snippets.hostedHtml} language="html" />
          <Button type="button" variant={done ? "secondary" : "outline"} className="w-fit" onClick={() => setDone(true)}>
            {done ? "Marked as done" : "I’ve pasted it — mark done"}
          </Button>
        </CardContent>
      </Card>

      <details className="rounded-xl border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Advanced installs</summary>
        <div className="flex flex-col gap-6 border-t border-border p-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Self-hosted script</h3>
            <p className="text-sm text-muted-foreground">{snippets.selfHostedNote}</p>
            <CodeBlock code={snippets.selfHostedHtml} language="html" />
          </div>

          {requireWidgetSigning ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Signed embed (required)</h3>
              <p className="text-sm text-muted-foreground">
                Widget signing is enabled. Use this snippet so the widget fetches a short-lived HMAC before each chat
                request.
              </p>
              <CodeBlock code={snippets.signedHtml} language="html" />
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Signed embed (optional)</h3>
              <p className="text-sm text-muted-foreground">
                Only needed when you turn on widget signing under Configure → Security.
              </p>
              <CodeBlock code={snippets.signedHtml} language="html" />
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-medium">React wrapper</h3>
            <p className="text-sm text-muted-foreground">
              Thin browser-only wrapper around the same widget lifecycle.
            </p>
            <CodeBlock code={snippets.reactInstall} language="bash" />
            <CodeBlock code={snippets.reactTsx} language="tsx" />
          </div>
        </div>
      </details>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Verify the embed</CardTitle>
          <CardDescription>Quick checklist after pasting a snippet into a host page.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            {snippets.verificationChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
