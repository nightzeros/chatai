"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Textarea } from "@/components/ui/textarea";
import { buildFaqPayload } from "@/lib/add-answer";
import type { AnalyticsMetrics, TopUnansweredQuestion } from "@/lib/analytics";
import type { EvalQuality } from "@/lib/eval-quality-metrics";
import { submitFaq } from "@/lib/submit-faq";

function formatConfidence(value: number | null) {
  return value === null ? "—" : value.toFixed(3);
}

function formatDuration(value: number | null) {
  return value === null ? "—" : `${value} ms`;
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

const metricDefinitions: Array<{
  key: keyof AnalyticsMetrics;
  label: string;
  description: string;
  format?: (value: number | null) => string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}> = [
  { key: "totalConversations", label: "Conversations", description: "All chat sessions" },
  { key: "totalQuestions", label: "Questions", description: "Messages from visitors" },
  {
    key: "answerRate",
    label: "Answer rate",
    description: "Answered ÷ knowledge questions (small talk excluded)",
    format: formatRate,
  },
  {
    key: "answered",
    label: "Answered",
    description: "From knowledge or earlier answers",
    tone: "success",
  },
  {
    key: "answeredWithContext",
    label: "From knowledge",
    description: "Answered with retrieved context",
  },
  {
    key: "answeredFromHistory",
    label: "From conversation",
    description: "Follow-ups answered from earlier grounded replies",
  },
  {
    key: "unanswered",
    label: "Unanswered",
    description: "Fallback or low confidence",
    tone: "warning",
  },
  { key: "conversational", label: "Small talk", description: "Greetings and thanks" },
  { key: "positiveFeedback", label: "Helpful", description: "Thumbs up responses", tone: "success" },
  {
    key: "negativeFeedback",
    label: "Not helpful",
    description: "Thumbs down responses",
    tone: "danger",
  },
  {
    key: "averageConfidence",
    label: "Avg. confidence",
    description: "Top retrieval similarity",
    format: formatConfidence,
  },
  {
    key: "averageResponseMs",
    label: "Avg. response time",
    description: "End-to-end generation time",
    format: formatDuration,
  },
];

export function AnalyticsDashboard({
  assistantId,
  metrics,
  topUnanswered,
  quality,
}: {
  assistantId: string;
  metrics: AnalyticsMetrics;
  topUnanswered: TopUnansweredQuestion[];
  quality: EvalQuality;
}) {
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addedQuestions, setAddedQuestions] = useState<Set<string>>(() => new Set());

  function startAnswering(value: string) {
    if (addedQuestions.has(value)) return;
    setActiveQuestion(value);
    setQuestion(value);
    setAnswer("");
    setError(null);
    setSuccess(null);
  }

  function cancelAnswering() {
    setActiveQuestion(null);
    setQuestion("");
    setAnswer("");
    setError(null);
  }

  async function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = buildFaqPayload(question, answer);
    if ("error" in payload) {
      setError(payload.error);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await submitFaq(fetch, assistantId, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSuccess("Added to knowledge. It is now processing for future chats.");
      setAddedQuestions((current) => new Set(current).add(activeQuestion ?? payload.question));
      setActiveQuestion(null);
      setQuestion("");
      setAnswer("");
    } catch {
      setError("Could not reach the knowledge API. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Analytics"
        description="All-time performance across your playground, widget, and API chats."
      />

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Unanswered questions</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Repeated questions where the assistant fell back or had low confidence — close these gaps
            first.
          </p>
          {success ? <p className="mt-2 text-sm text-success">{success}</p> : null}
        </div>
        {topUnanswered.length === 0 ? (
          <EmptyState
            title="No unanswered questions yet"
            description="Knowledge gaps will appear here as conversations arrive."
            className="py-12"
          />
        ) : (
          <ol className="overflow-hidden rounded-xl border border-border">
            {topUnanswered.map((item, index) => (
              <li
                key={`${item.question}-${index}`}
                className="border-t border-border px-4 py-3 first:border-t-0"
              >
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm leading-relaxed">{item.question}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums">
                      {item.count} {item.count === 1 ? "question" : "questions"}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => startAnswering(item.question)}
                      disabled={addedQuestions.has(item.question)}
                    >
                      {addedQuestions.has(item.question) ? "Added to knowledge" : "Add Answer"}
                    </Button>
                  </div>
                </div>
                {activeQuestion === item.question ? (
                  <form className="mt-4 rounded-lg bg-muted/40 p-4" onSubmit={submitAnswer}>
                    <div className="grid gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="analytics-question">Question</Label>
                        <Input
                          id="analytics-question"
                          value={question}
                          onChange={(event) => setQuestion(event.target.value)}
                          maxLength={500}
                          disabled={busy}
                          required
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="analytics-answer">Answer</Label>
                        <Textarea
                          id="analytics-answer"
                          value={answer}
                          onChange={(event) => setAnswer(event.target.value)}
                          maxLength={20_000}
                          rows={5}
                          disabled={busy}
                          required
                        />
                      </div>
                      {error ? <p className="text-sm text-destructive">{error}</p> : null}
                      <div className="flex gap-2">
                        <Button type="submit" disabled={busy}>
                          {busy ? "Adding…" : "Add to knowledge"}
                        </Button>
                        <Button type="button" variant="outline" onClick={cancelAnswering} disabled={busy}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </form>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
          <p className="mt-1 text-sm text-muted-foreground">Key volume and quality metrics.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metricDefinitions.map((metric) => {
            const value = metrics[metric.key];
            const tone =
              metric.key === "unanswered"
                ? value && value > 0
                  ? "warning"
                  : "default"
                : metric.key === "negativeFeedback"
                  ? value && value > 0
                    ? "danger"
                    : "default"
                  : (metric.tone ?? "default");
            return (
              <StatCard
                key={metric.key}
                label={metric.label}
                value={metric.format ? metric.format(value) : (value?.toLocaleString() ?? "—")}
                hint={metric.description}
                tone={tone}
              />
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">AI Quality</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Rolling averages from online sampling and offline regressions.
            </p>
          </div>
          <Link
            href={`/dashboard/assistants/${assistantId}/evals`}
            className="inline-flex h-8 items-center rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Manage test sets
          </Link>
        </div>
        {Object.keys(quality.averages).length === 0 ? (
          <EmptyState
            title="No eval scores yet"
            description="Run a regression on the Evals tab, or raise the online sample rate."
            className="py-12"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(quality.averages).map(([metric, score]) => (
              <StatCard
                key={metric}
                label={metric}
                value={score.toFixed(2)}
                hint="Average 0–1 LLM-as-judge score"
                tone={score < 0.5 ? "danger" : score < 0.7 ? "warning" : "success"}
              />
            ))}
          </div>
        )}
        {quality.lastRun ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Last run: {quality.lastRun.kind} · {quality.lastRun.status} ·{" "}
            {new Date(quality.lastRun.createdAt).toLocaleString()}
          </p>
        ) : null}
        {quality.recentFailures.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-medium">Recent low scores</h3>
            <ul className="mt-2 overflow-hidden rounded-xl border border-border">
              {quality.recentFailures.map((item, index) => (
                <li
                  key={`${item.metric}-${item.createdAt}-${index}`}
                  className="flex items-center justify-between gap-4 border-t border-border px-4 py-2 text-sm first:border-t-0"
                >
                  <span>
                    {item.metric} · {item.kind}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{item.score.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
