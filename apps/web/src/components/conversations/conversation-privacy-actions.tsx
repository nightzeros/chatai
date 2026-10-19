"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  deleteConversationAction,
  exportConversationAction,
  type ConversationActionState,
} from "@/app/dashboard/assistants/[id]/conversations/conversation-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Props = {
  assistantId: string;
  conversationId: string;
  sourceLabel: string;
  visitorLabel: string;
  hasRecording?: boolean;
  modalityHint?: string | null;
};

export function ConversationPrivacyActions({
  assistantId,
  conversationId,
  sourceLabel,
  visitorLabel,
  hasRecording = false,
  modalityHint = null,
}: Props) {
  const router = useRouter();
  const deleteFormRef = useRef<HTMLFormElement>(null);
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
    <div className="sticky top-0 z-10 -mx-1 space-y-3 rounded-lg border border-border bg-background/95 p-3 backdrop-blur-sm sm:mx-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{sourceLabel}</Badge>
        {modalityHint ? <Badge variant="outline">{modalityHint}</Badge> : null}
        {hasRecording ? <Badge variant="info">Has recording</Badge> : null}
        <span className="text-sm text-muted-foreground">{visitorLabel}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <form action={exportAction}>
          <input type="hidden" name="assistantId" value={assistantId} />
          <input type="hidden" name="conversationId" value={conversationId} />
          <Button type="submit" variant="outline" disabled={exportPending}>
            {exportPending ? "Exporting…" : "Export JSON"}
          </Button>
        </form>
        <p className="max-w-xs text-xs text-muted-foreground">
          Export includes messages, outcomes, sanitized debug, and voice metadata when present — not
          audio files.
        </p>
        <form ref={deleteFormRef} action={deleteAction} className="ml-auto">
          <input type="hidden" name="assistantId" value={assistantId} />
          <input type="hidden" name="conversationId" value={conversationId} />
          <ConfirmDialog
            destructive
            title="Delete this conversation?"
            description="Permanently delete this conversation and its messages. This cannot be undone."
            confirmLabel="Delete conversation"
            trigger={
              <Button type="button" variant="destructive" disabled={deletePending}>
                {deletePending ? "Deleting…" : "Delete conversation"}
              </Button>
            }
            onConfirm={() => deleteFormRef.current?.requestSubmit()}
          />
        </form>
      </div>
      {exportState && "error" in exportState ? (
        <p className="text-sm text-destructive">{exportState.error}</p>
      ) : null}
      {deleteState && "error" in deleteState ? (
        <p className="text-sm text-destructive">{deleteState.error}</p>
      ) : null}
      {exportState && "exportJson" in exportState ? (
        <p className="text-sm text-muted-foreground">Download started.</p>
      ) : null}
    </div>
  );
}
