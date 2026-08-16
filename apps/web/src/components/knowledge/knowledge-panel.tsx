"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type DocumentRow = {
  id: string;
  type: "file" | "text" | "faq";
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  createdAt: string;
};

type Tab = "file" | "text" | "faq";

function statusLabel(doc: DocumentRow) {
  if (doc.status === "pending" || doc.status === "processing") return "Processing…";
  if (doc.status === "ready") return `Ready · ${doc.chunkCount} chunk${doc.chunkCount === 1 ? "" : "s"}`;
  return doc.error ? `Failed · ${doc.error}` : "Failed";
}

export function KnowledgePanel({
  assistantId,
  initialDocuments,
}: {
  assistantId: string;
  initialDocuments: DocumentRow[];
}) {
  const [tab, setTab] = useState<Tab>("file");
  const [documents, setDocuments] = useState(initialDocuments);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const visible = useMemo(() => documents.filter((doc) => doc.type === tab), [documents, tab]);
  const inFlight = documents.some((doc) => doc.status === "pending" || doc.status === "processing");

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/assistants/${assistantId}/documents`);
      if (!response.ok) return;
      const data = (await response.json()) as { documents: DocumentRow[] };
      setDocuments(data.documents);
    }, 2000);
    return () => clearInterval(timer);
  }, [assistantId, inFlight]);

  async function refresh() {
    const response = await fetch(`/api/assistants/${assistantId}/documents`);
    if (!response.ok) return;
    const data = (await response.json()) as { documents: DocumentRow[] };
    setDocuments(data.documents);
  }

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setBusy(true);
    const form = new FormData();
    for (const file of list) form.append("files", file);
    const response = await fetch(`/api/assistants/${assistantId}/documents`, {
      method: "POST",
      body: form,
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Upload failed.");
      return;
    }
    await refresh();
  }

  async function addText(formData: FormData) {
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/assistants/${assistantId}/documents/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        content: String(formData.get("content") ?? ""),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not add text.");
      return;
    }
    await refresh();
  }

  async function addFaq(formData: FormData) {
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/assistants/${assistantId}/documents/faq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: String(formData.get("question") ?? ""),
        answer: String(formData.get("answer") ?? ""),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(data.error ?? "Could not add FAQ.");
      return;
    }
    await refresh();
  }

  async function remove(documentId: string) {
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/documents/${documentId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Could not delete document.");
      return;
    }
    setDocuments((current) => current.filter((doc) => doc.id !== documentId));
  }

  async function reprocess(documentId: string) {
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/documents/${documentId}/reprocess`, {
      method: "POST",
    });
    if (!response.ok) {
      setError("Could not reprocess document.");
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
        {(
          [
            ["file", "Documents"],
            ["text", "Text"],
            ["faq", "FAQs"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              tab === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "file" ? (
        <label
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
            dragOver ? "border-foreground bg-accent/40" : "border-border bg-muted/20",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void uploadFiles(event.dataTransfer.files);
          }}
        >
          <p className="text-sm font-medium">Drop PDF, TXT, Markdown, or DOCX files</p>
          <p className="mt-1 text-sm text-muted-foreground">Max 20 MB each. Click to browse.</p>
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.txt,.md,.markdown,.docx,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => {
              if (event.target.files) void uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}

      {tab === "text" ? (
        <Card>
          <CardHeader>
            <CardTitle>Add text</CardTitle>
            <CardDescription>Paste notes, policies, or any other source material.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void addText(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="text-name">Name</Label>
                <Input id="text-name" name="name" required maxLength={120} placeholder="Refund policy notes" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="text-content">Content</Label>
                <Textarea id="text-content" name="content" required className="min-h-40" />
              </div>
              <Button type="submit" disabled={busy} className="w-fit">
                {busy ? "Adding…" : "Add to knowledge"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {tab === "faq" ? (
        <Card>
          <CardHeader>
            <CardTitle>Add FAQ</CardTitle>
            <CardDescription>Store a question and answer as a knowledge entry.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void addFaq(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="faq-question">Question</Label>
                <Input id="faq-question" name="question" required maxLength={500} placeholder="What is your refund period?" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="faq-answer">Answer</Label>
                <Textarea id="faq-answer" name="answer" required className="min-h-28" />
              </div>
              <Button type="submit" disabled={busy} className="w-fit">
                {busy ? "Adding…" : "Add FAQ"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col gap-3">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this tab yet.</p>
        ) : (
          visible.map((doc) => (
            <div key={doc.id} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.name}</p>
                <p
                  className={cn(
                    "mt-1 text-sm",
                    doc.status === "failed" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {doc.status === "ready" ? "✓ " : null}
                  {statusLabel(doc)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void reprocess(doc.id)}>
                  Reprocess
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => void remove(doc.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
