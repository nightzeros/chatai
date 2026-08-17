/** @jsxImportSource preact */
import { useEffect, useMemo, useState } from "preact/hooks";
import type { WidgetControllerOptions, WidgetState } from "@chatai/widget-core";

import { createWidgetController } from "@chatai/widget-core";

export type WidgetSettings = {
  primaryColor?: string;
  position?: "bottom-left" | "bottom-right";
  theme?: "light" | "dark" | "system";
  iconUrl?: string | null;
  suggestedQuestions?: string[];
  showSources?: boolean;
};

export type WidgetAppProps = WidgetControllerOptions &
  WidgetSettings & {
    layout?: "fixed" | "contained";
  };

type Props = WidgetAppProps;

function settingOverrides(props: Props): WidgetSettings {
  return {
    primaryColor: props.primaryColor,
    position: props.position,
    theme: props.theme,
    iconUrl: props.iconUrl,
    suggestedQuestions: props.suggestedQuestions,
    showSources: props.showSources,
  };
};

const EMPTY_STATE: WidgetState = { status: "loading", messages: [] };

function settingsFrom(state: WidgetState, props: Props): WidgetSettings {
  const settings = (state.config?.settings ?? {}) as WidgetSettings;
  return {
    ...settings,
    ...Object.fromEntries(Object.entries(settingOverrides(props)).filter(([, value]) => value !== undefined)),
    theme: props.theme ?? settings.theme ?? "system",
    position: props.position ?? settings.position ?? "bottom-right",
  };
}

function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 11.5a7.5 7.5 0 0 1-9.4 7.3L5 21l1.4-4.2A7.5 7.5 0 1 1 20 11.5Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" stroke-linecap="round" />
    </svg>
  );
}

export function WidgetApp(props: Props) {
  const controller = useMemo(
    () =>
      createWidgetController({
        assistantId: props.assistantId,
        apiUrl: props.apiUrl,
        fetch: props.fetch,
        storage: props.storage,
        createId: props.createId,
      }),
    [props.assistantId, props.apiUrl, props.fetch, props.storage, props.createId],
  );
  const [state, setState] = useState<WidgetState>(EMPTY_STATE);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.load();
    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [controller]);

  const settings = settingsFrom(state, props);
  const questions = settings.suggestedQuestions?.filter(Boolean) ?? [];
  const busy = state.status === "streaming";
  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  function send(message: string) {
    if (!message.trim()) return;
    setDraft("");
    void controller.send(message);
  }

  function rate(messageId: string, rating: "positive" | "negative") {
    void controller.sendFeedback(messageId, rating).catch(() => undefined);
  }

  return (
    <div
      className={`chatai-widget ${isDark ? "theme-dark" : "theme-light"} ${settings.position === "bottom-left" ? "position-left" : "position-right"} ${props.layout === "contained" ? "layout-contained" : ""}`}
      style={{ "--chatai-accent": settings.primaryColor ?? "#0F766E" }}
    >
      {open ? (
        <section className="chatai-panel" role="dialog" aria-label={`${state.config?.name ?? "Assistant"} chat`}>
          <header className="chatai-header">
            <div>
              <p className="chatai-kicker">Knowledge assistant</p>
              <h2>{state.config?.name ?? "Loading assistant…"}</h2>
            </div>
            <button type="button" className="chatai-close" onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </header>

          <div className="chatai-transcript" aria-live="polite">
            {state.config?.welcomeMessage ? (
              <article className="chatai-message assistant">
                <p>{state.config.welcomeMessage}</p>
              </article>
            ) : null}
            {questions.length > 0 && state.messages.length === 0 ? (
              <div className="chatai-prompts">
                {questions.map((question) => (
                  <button key={question} type="button" onClick={() => send(question)} disabled={busy}>
                    {question}
                  </button>
                ))}
              </div>
            ) : null}
            {state.messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`chatai-message ${message.role}`}>
                <p>{message.content || (busy && message.role === "assistant" ? "Thinking…" : "")}</p>
                {settings.showSources !== false && message.sources?.length ? (
                  <ul className="chatai-sources" aria-label="Sources">
                    {message.sources.map((source) => (
                      <li key={`${source.documentId}-${source.chunkId ?? source.page ?? source.documentName}`}>
                        <strong>{source.documentName}</strong>
                        {source.page != null ? ` · p. ${source.page}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.role === "assistant" && message.id ? (
                  <div className="chatai-feedback">
                    <span>Was this helpful?</span>
                    <button
                      type="button"
                      aria-label="Mark response helpful"
                      aria-pressed={message.feedback === "positive"}
                      onClick={() => rate(message.id!, "positive")}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Mark response not helpful"
                      aria-pressed={message.feedback === "negative"}
                      onClick={() => rate(message.id!, "negative")}
                    >
                      ↓
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {state.error ? <p className="chatai-error">{state.error}</p> : null}
          </div>

          <form
            className="chatai-composer"
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
          >
            <label className="chatai-visually-hidden" htmlFor="chatai-message-input">
              Message
            </label>
            <input
              id="chatai-message-input"
              value={draft}
              onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
              placeholder="Ask a question…"
              maxLength={4000}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">
              ↑
            </button>
          </form>
        </section>
      ) : null}

      <button type="button" className="chatai-launcher" onClick={() => setOpen((value) => !value)} aria-label="Open chat">
        {settings.iconUrl ? <img src={settings.iconUrl} alt="" /> : <ChatGlyph />}
      </button>
    </div>
  );
}
