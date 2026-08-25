"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InstallSnippets } from "@/lib/install-snippets";

function SnippetBlock({
  title,
  description,
  code,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
  description: string;
  code: string;
  copyId: string;
  copiedId: string | null;
  onCopy: (id: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onCopy(copyId, code)}>
          {copiedId === copyId ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function InstallSnippetsPanel({ snippets }: { snippets: InstallSnippets }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Install</CardTitle>
          <CardDescription>
            Embed this assistant with one script tag, a self-hosted copy of the same bundle, or the
            React wrapper.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Public ID
            </p>
            <p className="mt-2 font-mono text-sm">{snippets.publicId}</p>
            <p className="mt-3 text-sm text-muted-foreground">{snippets.securityNote}</p>
          </div>

          <SnippetBlock
            title="Hosted script"
            description="Primary install path. The widget discovers this ChatAI origin from the script URL."
            code={snippets.hostedHtml}
            copyId="hosted"
            copiedId={copiedId}
            onCopy={copy}
          />

          <SnippetBlock
            title="Self-hosted script"
            description={snippets.selfHostedNote}
            code={snippets.selfHostedHtml}
            copyId="self-hosted"
            copiedId={copiedId}
            onCopy={copy}
          />

          <SnippetBlock
            title="Signed embed"
            description="Use when widget signing is enabled. The widget fetches a short-lived HMAC from data-sign-endpoint before each chat request."
            code={snippets.signedHtml}
            copyId="signed"
            copiedId={copiedId}
            onCopy={copy}
          />

          <div className="flex flex-col gap-3">
            <SnippetBlock
              title="React wrapper"
              description="Thin browser-only wrapper around the same widget lifecycle. @chatai/react is a private workspace package — install via workspace:* inside this monorepo until it is published to npm."
              code={snippets.reactTsx}
              copyId="react"
              copiedId={copiedId}
              onCopy={copy}
            />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2">
              <code className="text-xs whitespace-pre-wrap">{snippets.reactInstall}</code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copy("react-install", snippets.reactInstall)}
              >
                {copiedId === "react-install" ? "Copied" : "Copy command"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
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
