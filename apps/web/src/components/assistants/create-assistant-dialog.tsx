"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { createAssistant } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CreateAssistantDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createAssistant, null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Create Assistant
      </Button>
      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/40"
        onClose={() => setOpen(false)}
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Create assistant</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Give it a name and optional instructions. You can change these later.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={80} placeholder="TBM Assistant" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" maxLength={500} placeholder="Support bot for our docs" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="welcomeMessage">Welcome message</Label>
            <Input
              id="welcomeMessage"
              name="welcomeMessage"
              maxLength={500}
              placeholder="Hi! How can I help you today?"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="instructions">Instructions</Label>
            <Textarea
              id="instructions"
              name="instructions"
              maxLength={8000}
              placeholder="You are the AI assistant for TBM Systems. Answer using the knowledge base. Do not make up information."
            />
          </div>
          {state && "error" in state ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
