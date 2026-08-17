"use client";

import { ChatWidget } from "@chatai/react";

import type { AssistantSettingsInput } from "@/lib/assistant-settings";
import { previewWidgetOptions } from "@/lib/widget-preview";

type PreviewWidgetInput = {
  assistantId: string;
  apiUrl: string;
  settings: AssistantSettingsInput;
};

export function WidgetPreview({ assistantId, apiUrl, settings }: PreviewWidgetInput) {
  return (
    <aside className="rounded-xl border border-border bg-muted/30 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Draft preview</p>
      <div className="mt-5 h-80 overflow-hidden rounded-lg border border-border bg-background p-4">
        <ChatWidget className="h-full" {...previewWidgetOptions({ assistantId, apiUrl, settings })} />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Draft preview — not published until you save.</p>
    </aside>
  );
}
