"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import {
  deleteConversationAction,
  exportConversationAction,
  type ConversationActionState,
} from "@/app/dashboard/assistants/[id]/conversations/conversation-actions";
import { Button } from "@/components/ui/button";

type Props = {
  assistantId: string;
  conversationId: string;
};

export function ConversationPrivacyActions({ assistantId, conversationId }: Props) {
  const router = useRouter();
  const [exportState, exportAction, exportPending] = useActionState<
    ConversationActionState,
    FormData
  >(exportConversationAction, null);
  const [deleteState, deleteAction, deletePending] = useActionState<
    ConversationActionState,
    FormData
  >(deleteConversationAction, null);

  useEffect(() => {
    if (exportState && "exportJson" in exportState) {
      const blob = new Blob([exportState.exportJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportState.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  }, [exportState]);

  useEffect(() => {
    if (deleteState && "deleted" in deleteState) {
      router.push(`/dashboard/assistants/${assistantId}/conversations`);
      router.refresh();
    }
  }, [deleteState, assistantId, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={exportAction}>
        <input type="hidden" name="assistantId" value={assistantId} />
        <input type="hidden" name="conversationId" value={conversationId} />
        <Button type="submit" variant="outline" disabled={exportPending}>
          {exportPending ? "Exporting…" : "Export JSON"}
        </Button>
      </form>
      <form
        action={deleteAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              "Permanently delete this conversation and its messages? This cannot be undone.",
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="assistantId" value={assistantId} />
        <input type="hidden" name="conversationId" value={conversationId} />
        <Button type="submit" variant="destructive" disabled={deletePending}>
          {deletePending ? "Deleting…" : "Delete conversation"}
        </Button>
      </form>
      {exportState && "error" in exportState ? (
        <p className="text-sm text-destructive">{exportState.error}</p>
      ) : null}
      {deleteState && "error" in deleteState ? (
        <p className="text-sm text-destructive">{deleteState.error}</p>
      ) : null}
    </div>
  );
}
