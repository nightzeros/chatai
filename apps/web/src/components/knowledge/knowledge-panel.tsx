"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_UPLOAD_LABEL } from "@/lib/upload-allowlist";
import { cn } from "@/lib/utils";

type DocumentRow = {
  id: string;
  type: "file" | "text" | "faq" | "url";
  name: string;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  createdAt: string;
  url?: string | null;
  excluded?: boolean;
  sourceId?: string | null;
};

type SourceRow = {
  id: string;
  name: string;
  status: "pending" | "syncing" | "ready" | "failed";
  error: string | null;
  config: { startUrl: string; maxPages?: number; maxDepth?: number };
  lastSyncedAt: string | null;
};

type SourceDetail = {
  source: SourceRow;
  pages: DocumentRow[];
};

type Tab = "sources" | "file" | "text" | "faq";

function statusLabel(doc: Pick<DocumentRow, "status" | "chunkCount" | "error">) {
  if (doc.status === "pending" || doc.status === "processing") return "Processing…";
  if (doc.status === "ready") return `Ready · ${doc.chunkCount} chunk${doc.chunkCount === 1 ? "" : "s"}`;
  return doc.error ? `Failed · ${doc.error}` : "Failed";
}

function sourceStatusLabel(source: SourceRow) {
  if (source.status === "pending" || source.status === "syncing") return "Syncing…";
  if (source.status === "ready") {
    return source.lastSyncedAt ? `Ready · synced ${new Date(source.lastSyncedAt).toLocaleString()}` : "Ready";
  }
  return source.error ? `Failed · ${source.error}` : "Failed";
}

export function KnowledgePanel({
  assistantId,
  initialDocuments,
  initialSources,
}: {
  assistantId: string;
  initialDocuments: DocumentRow[];
  initialSources: SourceDetail[];
}) {
  const [tab, setTab] = useState<Tab>("sources");
  const [documents, setDocuments] = useState(initialDocuments);
  const [sources, setSources] = useState(initialSources);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const visible = useMemo(() => documents.filter((doc) => doc.type === tab), [documents, tab]);
  const sourcePagesInFlight = sources.some((entry) =>
    entry.pages.some((page) => page.status === "pending" || page.status === "processing"),
  );
  const sourcesInFlight = sources.some(
    (entry) => entry.source.status === "pending" || entry.source.status === "syncing",
  );
  const documentsInFlight = documents.some((doc) => doc.status === "pending" || doc.status === "processing");
  const inFlight = sourcePagesInFlight || sourcesInFlight || documentsInFlight;

  const refreshDocuments = useCallback(async () => {
    const response = await fetch(`/api/assistants/${assistantId}/documents`);
    if (!response.ok) return;
    const data = (await response.json()) as { documents: DocumentRow[] };
    setDocuments(data.documents);
  }, [assistantId]);

  const refreshSources = useCallback(async () => {
    const response = await fetch(`/api/assistants/${assistantId}/sources`);
    if (!response.ok) return;
    const data = (await response.json()) as { sources: SourceRow[] };
    const detailed = await Promise.all(
      data.sources.map(async (source) => {
        const detailResponse = await fetch(`/api/assistants/${assistantId}/sources/${source.id}`);
        if (!detailResponse.ok) return { source, pages: [] };
        return (await detailResponse.json()) as SourceDetail;
      }),
    );
    setSources(detailed);
  }, [assistantId]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshDocuments(), refreshSources()]);
  }, [refreshDocuments, refreshSources]);

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  async function addWebsite(formData: FormData) {
    setError(null);
    setBusy(true);
    const maxPagesRaw = String(formData.get("maxPages") ?? "").trim();
    const maxDepthRaw = String(formData.get("maxDepth") ?? "").trim();
    const response = await fetch(`/api/assistants/${assistantId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrl: String(formData.get("startUrl") ?? ""),
        ...(maxPagesRaw ? { maxPages: Number(maxPagesRaw) } : {}),
        ...(maxDepthRaw ? { maxDepth: Number(maxDepthRaw) } : {}),
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(
        response.status === 409
          ? (data.error ?? "This website has already been added.")
          : (data.error ?? "Could not add website."),
      );
      return;
    }
    await refreshSources();
  }

  async function syncSource(sourceId: string) {
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/sources/${sourceId}/sync`, {
      method: "POST",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not sync website.");
      return;
    }
    await refreshSources();
  }

  async function removeSource(sourceId: string) {
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/sources/${sourceId}`, {
      method: "DELETE",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not delete source.");
      return;
    }
    setSources((current) => current.filter((entry) => entry.source.id !== sourceId));
    await refreshDocuments();
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
    await refreshDocuments();
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
    await refreshDocuments();
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
    await refreshDocuments();
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
    setSources((current) =>
      current.map((entry) => ({
        ...entry,
        pages: entry.pages.filter((page) => page.id !== documentId),
      })),
    );
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

  async function toggleExclude(documentId: string) {
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/documents/${documentId}/exclude`, {
      method: "POST",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string; excluded?: boolean };
    if (!response.ok) {
      setError(data.error ?? "Could not update page.");
      return;
    }
    setSources((current) =>
      current.map((entry) => ({
        ...entry,
        pages: entry.pages.map((page) =>
          page.id === documentId ? { ...page, excluded: data.excluded ?? page.excluded } : page,
        ),
      })),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 rounded-lg border border-border p-1 w-fit flex-wrap">
        {(
          [
            ["sources", "Sources"],
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

      {tab === "sources" ? (
        <Card>
          <CardHeader>
            <CardTitle>Add website</CardTitle>
            <CardDescription>Crawl same-origin pages from a start URL. Re-sync anytime to pick up changes.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void addWebsite(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="website-url">Start URL</Label>
                <Input id="website-url" name="startUrl" required placeholder="https://docs.example.com" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="website-max-pages">Max pages (optional)</Label>
                  <Input id="website-max-pages" name="maxPages" type="number" min={1} max={200} placeholder="50" />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="website-max-depth">Max depth (optional)</Label>
                  <Input id="website-max-depth" name="maxDepth" type="number" min={1} max={5} placeholder="3" />
                </div>
              </div>
              <Button type="submit" disabled={busy} className="w-fit">
                {busy ? "Starting sync…" : "Crawl website"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

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
          <p className="text-sm font-medium">Drop {ALLOWED_UPLOAD_LABEL} files</p>
          <p className="mt-1 text-sm text-muted-foreground">Max 20 MB each. Click to browse.</p>
          <input
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.txt,.md,.markdown,.docx,.csv,.html,.htm,.json,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/html,application/json"
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

      {tab === "sources" ? (
        <div className="flex flex-col gap-4">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No websites yet.</p>
          ) : (
            sources.map(({ source, pages }) => (
              <div key={source.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{source.name}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{source.config.startUrl}</p>
                    <p
                      className={cn(
                        "mt-1 text-sm",
                        source.status === "failed" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {sourceStatusLabel(source)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void syncSource(source.id)}>
                      Re-sync
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => void removeSource(source.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                  {pages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No pages discovered yet.</p>
                  ) : (
                    pages.map((page) => (
                      <div
                        key={page.id}
                        className={cn(
                          "flex flex-col gap-3 rounded-lg border border-border/70 p-3 sm:flex-row sm:items-center sm:justify-between",
                          page.excluded ? "opacity-60" : undefined,
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{page.name}</p>
                          <p className="mt-1 truncate text-sm text-muted-foreground">{page.url}</p>
                          <p
                            className={cn(
                              "mt-1 text-sm",
                              page.status === "failed" ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {page.excluded ? "Excluded · " : null}
                            {statusLabel(page)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => void toggleExclude(page.id)}>
                            {page.excluded ? "Include" : "Exclude"}
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => void reprocess(page.id)}>
                            Reprocess
                          </Button>
                          <Button type="button" variant="destructive" size="sm" onClick={() => void remove(page.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
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
      )}
    </div>
  );
}
