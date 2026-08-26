"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";

import { DebugPanel } from "@/components/playground/debug-panel";
import { MarkdownMessage } from "@/components/playground/markdown-message";
import { SourcesBlock } from "@/components/playground/sources-block";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatRequestError, streamChat, type ChatMetaEvent } from "@/lib/chat-client";
import { cn } from "@/lib/utils";

type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  streaming: boolean;
  error?: string;
  meta?: Omit<ChatMetaEvent, "type">;
  feedback?: "positive" | "negative";
};

function visitorId() {
  const key = "chatai.playground.visitor";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const created = crypto.randomUUID();
  sessionStorage.setItem(key, created);
  return created;
}

export function PlaygroundChat({
  publicId,
  name,
  welcomeMessage,
}: {
  publicId: string;
  name: string;
  welcomeMessage: string;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [ratingMessageId, setRatingMessageId] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [turns]);

  function resetChat() {
    setTurns([]);
    setConversationId(undefined);
    setError(null);
    input.current?.focus();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;

    const turnId = crypto.randomUUID();
    setDraft("");
    setError(null);
    setBusy(true);
    setTurns((current) => [
      ...current,
      { id: turnId, question: message, answer: "", streaming: true },
    ]);

    try {
      for await (const event of streamChat({
        assistantId: publicId,
        message,
        conversationId,
        visitorId: visitorId(),
        source: "playground",
      })) {
        if (event.type === "token") {
          setTurns((current) =>
            current.map((turn) =>
              turn.id === turnId ? { ...turn, answer: turn.answer + event.text } : turn,
            ),
          );
        }
        if (event.type === "meta") {
          const meta = {
            messageId: event.messageId,
            conversationId: event.conversationId,
            sources: event.sources,
            confidence: event.confidence,
            outcome: event.outcome,
            debug: event.debug,
          };
          setConversationId(meta.conversationId);
          setTurns((current) =>
            current.map((turn) => (turn.id === turnId ? { ...turn, meta, streaming: false } : turn)),
          );
        }
        if (event.type === "done") {
          setTurns((current) =>
            current.map((turn) => (turn.id === turnId ? { ...turn, streaming: false } : turn)),
          );
        }
      }
    } catch (caught) {
      if (caught instanceof ChatRequestError) {
        setError(caught.message);
      } else {
        setError("Could not reach the chat API.");
      }
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                streaming: false,
                error: caught instanceof Error ? caught.message : "Request failed.",
                answer: turn.answer || "I ran into a problem generating a response. Please try again.",
              }
            : turn,
        ),
      );
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  async function rate(messageId: string, rating: "positive" | "negative") {
    if (ratingMessageId) return;
    setRatingMessageId(messageId);
    try {
      const response = await fetch("/api/v1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, rating }),
      });
      if (!response.ok) throw new Error("Unable to save feedback.");

      setTurns((current) =>
        current.map((turn) =>
          turn.meta?.messageId === messageId ? { ...turn, feedback: rating } : turn,
        ),
      );
    } catch {
      setError("Could not save feedback.");
    } finally {
      setRatingMessageId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold tracking-tight">Playground</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Chat through the public API and inspect retrieval under each answer.
        </p>
      </div>
    <div className="flex h-[min(720px,calc(100dvh-9rem))] min-h-[18rem] flex-col overflow-hidden rounded-xl border border-border bg-card sm:min-h-[24rem] md:min-h-[28rem] md:h-[min(720px,calc(100dvh-16rem))]">
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">Public chat API · playground source</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={resetChat} disabled={busy} className="w-full sm:w-auto">
          <RotateCcw />
          New chat
        </Button>
      </div>

      <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
        <div className="mx-auto flex max-w-2xl flex-col gap-5">
          <div className="rounded-2xl rounded-tl-md bg-muted/60 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{name}</p>
            <p className="mt-1 text-sm leading-relaxed">{welcomeMessage}</p>
          </div>

          {turns.map((turn) => (
            <div key={turn.id} className="flex flex-col gap-3">
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-primary-foreground">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.question}</p>
              </div>
              <div
                className={cn(
                  "max-w-[92%] rounded-2xl rounded-tl-md border border-border bg-background px-4 py-3",
                  turn.error ? "border-destructive/40" : null,
                )}
              >
                {turn.streaming && !turn.answer ? (
                  <p className="text-sm text-muted-foreground">Thinking…</p>
                ) : (
                  <MarkdownMessage content={turn.answer} streaming={turn.streaming} />
                )}
                {turn.meta ? (
                  <>
                    <SourcesBlock sources={turn.meta.sources} />
                    <DebugPanel
                      outcome={turn.meta.outcome}
                      confidence={turn.meta.confidence}
                      debug={turn.meta.debug}
                    />
                    <div className="mt-3 flex items-center gap-1 border-t border-border pt-3">
                      <span className="mr-1 text-xs text-muted-foreground">Was this helpful?</span>
                      <Button
                        type="button"
                        variant={turn.feedback === "positive" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void rate(turn.meta!.messageId, "positive")}
                        aria-label="Mark response helpful"
                        aria-pressed={turn.feedback === "positive"}
                        disabled={ratingMessageId === turn.meta.messageId}
                      >
                        <ThumbsUp />
                      </Button>
                      <Button
                        type="button"
                        variant={turn.feedback === "negative" ? "secondary" : "ghost"}
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => void rate(turn.meta!.messageId, "negative")}
                        aria-label="Mark response not helpful"
                        aria-pressed={turn.feedback === "negative"}
                        disabled={ratingMessageId === turn.meta.messageId}
                      >
                        <ThumbsDown />
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <form
        className="border-t border-border p-2.5 sm:p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        {error ? <p className="mb-2 px-1 text-sm text-destructive">{error}</p> : null}
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="playground-message">
            Message
          </label>
          <Textarea
            ref={input}
            id="playground-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask a question…"
            maxLength={4000}
            disabled={busy}
            className="min-h-[44px] max-h-36 resize-none py-2.5"
            rows={1}
          />
          <Button type="submit" size="icon" disabled={busy || draft.trim().length === 0} aria-label="Send">
            <ArrowUp />
          </Button>
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground max-sm:hidden">Enter to send · Shift+Enter for a new line</p>
      </form>
    </div>
    </div>
  );
}
