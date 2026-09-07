"use client";

import { useActionState, useEffect, useState } from "react";

import { createAssistant } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CreateAssistantDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createAssistant, null);

  useEffect(() => {
    if (state && "error" in state) {
      setOpen(true);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">Create Assistant</Button>
      </DialogTrigger>
      <DialogContent>
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create assistant</DialogTitle>
            <DialogDescription>
              Give it a name and optional instructions. You will land on Overview to finish setup.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={80} placeholder="Support Assistant" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" name="description" maxLength={500} placeholder="Answers questions from our docs" />
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
              placeholder="Answer using the knowledge base. Do not make up information."
            />
          </div>
          {state && "error" in state ? (
            <div className="space-y-2 text-sm">
              <p className="text-destructive">{state.error}</p>
              {state.error.toLowerCase().includes("assistant limit") ||
              state.error.toLowerCase().includes("upgrade") ? (
                <a
                  href="/dashboard/billing"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Upgrade plan
                </a>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
