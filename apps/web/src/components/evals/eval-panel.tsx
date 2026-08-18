"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EvalRunDetailsView, EvalRunRowChevron } from "@/components/evals/eval-run-details-view";
import type { EvalRunDetails } from "@chatai/evals";
import { runHasLowScores, runNeedsAttention } from "@/lib/eval-run-details-format";

export type EvalCaseRow = {
  id: string;
  question: string;
  expectedAnswer: string | null;
};

export type EvalSetRow = {
  id: string;
  name: string;
  cases: EvalCaseRow[];
};

export type EvalRunRow = {
  id: string;
  evalSetId: string | null;
  kind: "online" | "offline";
  status: "pending" | "running" | "completed" | "failed";
  summary: {
    caseCount?: number;
    scoredCount?: number;
    averages?: Record<string, number>;
    error?: string;
  } | null;
  createdAt: string;
};

function formatAverages(averages?: Record<string, number>) {
  if (!averages || Object.keys(averages).length === 0) return "—";
  return Object.entries(averages)
    .map(([metric, score]) => `${metric} ${score.toFixed(2)}`)
    .join(" · ");
}

function statusLabel(status: EvalRunRow["status"]) {
  if (status === "pending" || status === "running") return "Running…";
  if (status === "completed") return "Completed";
  return "Failed";
}

export function EvalPanel({
  assistantId,
  initialSets,
  initialRuns,
}: {
  assistantId: string;
  initialSets: EvalSetRow[];
  initialRuns: EvalRunRow[];
}) {
  const [sets, setSets] = useState(initialSets);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedId, setSelectedId] = useState(initialSets[0]?.id ?? null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, EvalRunDetails>>({});
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => sets.find((set) => set.id === selectedId) ?? null,
    [sets, selectedId],
  );

  const inFlight = runs.some((run) => run.status === "pending" || run.status === "running");

  const refresh = useCallback(async () => {
    const [setsResponse, runsResponse] = await Promise.all([
      fetch(`/api/assistants/${assistantId}/eval-sets`),
      fetch(`/api/assistants/${assistantId}/eval-runs`),
    ]);
    if (setsResponse.ok) {
      const data = (await setsResponse.json()) as { sets: EvalSetRow[] };
      setSets(data.sets);
    }
    if (runsResponse.ok) {
      const data = (await runsResponse.json()) as { runs: EvalRunRow[] };
      setRuns(
        data.runs.map((run) => ({
          ...run,
          createdAt:
            typeof run.createdAt === "string" ? run.createdAt : new Date(run.createdAt).toISOString(),
        })),
      );
    }
  }, [assistantId]);

  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  async function createSet(formData: FormData) {
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/assistants/${assistantId}/eval-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(formData.get("name") ?? "") }),
    });
    const data = (await response.json().catch(() => null)) as { set?: EvalSetRow; error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(data?.error ?? "Could not create test set.");
      return;
    }
    if (data?.set) {
      setSets((current) => [{ ...data.set!, cases: [] }, ...current]);
      setSelectedId(data.set.id);
    }
  }

  async function deleteSet(setId: string) {
    if (!window.confirm("Delete this test set and its questions?")) return;
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/eval-sets/${setId}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete test set.");
      return;
    }
    setSets((current) => current.filter((set) => set.id !== setId));
    setSelectedId((current) => (current === setId ? null : current));
  }

  async function addCase(formData: FormData) {
    if (!selected) return;
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/assistants/${assistantId}/eval-sets/${selected.id}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: String(formData.get("question") ?? ""),
        expectedAnswer: String(formData.get("expectedAnswer") ?? ""),
      }),
    });
    const data = (await response.json().catch(() => null)) as { case?: EvalCaseRow; error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(data?.error ?? "Could not add question.");
      return;
    }
    if (data?.case) {
      setSets((current) =>
        current.map((set) =>
          set.id === selected.id ? { ...set, cases: [...set.cases, data.case!] } : set,
        ),
      );
    }
  }

  async function deleteCase(caseId: string) {
    if (!selected) return;
    const response = await fetch(
      `/api/assistants/${assistantId}/eval-sets/${selected.id}/cases/${caseId}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setError("Could not delete question.");
      return;
    }
    setSets((current) =>
      current.map((set) =>
        set.id === selected.id ? { ...set, cases: set.cases.filter((item) => item.id !== caseId) } : set,
      ),
    );
  }

  async function runRegression() {
    if (!selected) return;
    setError(null);
    setBusy(true);
    const response = await fetch(`/api/assistants/${assistantId}/eval-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evalSetId: selected.id }),
    });
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!response.ok) {
      setError(data?.error ?? "Could not start regression.");
      return;
    }
    await refresh();
  }

  async function toggleRunDetails(runId: string) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }

    setExpandedRunId(runId);
    if (runDetails[runId]) return;

    setLoadingRunId(runId);
    setError(null);
    const response = await fetch(`/api/assistants/${assistantId}/eval-runs/${runId}`);
    const data = (await response.json().catch(() => null)) as EvalRunDetails | { error?: string } | null;
    setLoadingRunId(null);

    if (!response.ok || !data || "error" in data || !("cases" in data)) {
      setError((data && "error" in data && data.error) || "Could not load eval run details.");
      setExpandedRunId(null);
      return;
    }

    setRunDetails((current) => ({ ...current, [runId]: data }));
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Eval test sets</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Store Q/A pairs and run an offline regression against the current knowledge base.
          </p>
        </div>
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Sets</CardTitle>
              <CardDescription>Owner-only. Widget visitors never see this.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form
                className="flex flex-col gap-2"
                action={(formData) => {
                  void createSet(formData);
                }}
              >
                <Label htmlFor="eval-set-name">New set</Label>
                <Input id="eval-set-name" name="name" maxLength={120} placeholder="Refunds" required />
                <Button type="submit" disabled={busy} size="sm" className="w-fit">
                  Create
                </Button>
              </form>
              {sets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No test sets yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sets.map((set) => (
                    <li key={set.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(set.id)}
                        className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                          selectedId === set.id ? "bg-muted font-medium" : "hover:bg-muted/60"
                        }`}
                      >
                        <span className="block truncate">{set.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {set.cases.length} {set.cases.length === 1 ? "question" : "questions"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{selected?.name ?? "Select a set"}</CardTitle>
              <CardDescription>
                Changing knowledge or RAG settings only shows up here after you run a regression.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {selected ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void runRegression()} disabled={busy}>
                      {busy ? "Starting…" : "Run regression"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void deleteSet(selected.id)}>
                      Delete set
                    </Button>
                  </div>

                  <form
                    className="grid gap-3 rounded-lg border border-border p-4"
                    action={(formData) => {
                      void addCase(formData);
                    }}
                  >
                    <div className="grid gap-2">
                      <Label htmlFor="eval-question">Question</Label>
                      <Input id="eval-question" name="question" maxLength={2000} required />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="eval-expected">Expected answer (optional rubric)</Label>
                      <Textarea id="eval-expected" name="expectedAnswer" maxLength={8000} rows={3} />
                    </div>
                    <Button type="submit" variant="outline" disabled={busy} className="w-fit">
                      Add question
                    </Button>
                  </form>

                  {selected.cases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Add at least one question to run a regression.</p>
                  ) : (
                    <ul className="overflow-hidden rounded-xl border border-border">
                      {selected.cases.map((item) => (
                        <li key={item.id} className="border-t border-border px-4 py-3 first:border-t-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm">{item.question}</p>
                              {item.expectedAnswer ? (
                                <p className="mt-1 text-xs text-muted-foreground">{item.expectedAnswer}</p>
                              ) : null}
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void deleteCase(item.id)}>
                              Remove
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Create a test set to get started.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Run history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Click any run to inspect questions, retrieved context, answers, and judge explanations.
          </p>
        </div>
        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
            <p className="text-sm font-medium">No eval runs yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Run a regression or enable online sampling.</p>
          </div>
        ) : (
          <ol className="overflow-hidden rounded-xl border border-border">
            {runs.map((run) => {
              const expanded = expandedRunId === run.id;
              const attention = runNeedsAttention(run);
              const lowScores = runHasLowScores(run);
              return (
                <li key={run.id} className="border-t border-border first:border-t-0">
                  <button
                    type="button"
                    onClick={() => void toggleRunDetails(run.id)}
                    aria-expanded={expanded}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 ${
                      attention ? "bg-amber-500/5 hover:bg-amber-500/10" : ""
                    }`}
                  >
                    <EvalRunRowChevron expanded={expanded} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">
                            {run.kind === "offline" ? "Offline" : "Online"} · {statusLabel(run.status)}
                          </p>
                          {run.status === "failed" ? (
                            <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                              Failed
                            </span>
                          ) : null}
                          {lowScores ? (
                            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              Low score
                            </span>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{formatAverages(run.summary?.averages)}</p>
                      {run.summary?.error ? (
                        <p className="mt-1 text-sm text-destructive">{run.summary.error}</p>
                      ) : null}
                      {!expanded ? (
                        <p className="mt-1 text-xs text-muted-foreground">Click to inspect details</p>
                      ) : null}
                    </div>
                  </button>
                  {expanded ? (
                    loadingRunId === run.id ? (
                      <p className="px-4 pb-4 text-sm text-muted-foreground">Loading details…</p>
                    ) : runDetails[run.id] ? (
                      <div className="px-4 pb-4">
                        <EvalRunDetailsView details={runDetails[run.id]!} />
                      </div>
                    ) : (
                      <p className="px-4 pb-4 text-sm text-muted-foreground">Could not load run details.</p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
