/** @jsxImportSource preact */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { WidgetControllerOptions, WidgetState } from "@nightzeros/chatai-widget-core";

import {
  createWidgetController,
  isVoiceActive,
  mergeVoiceAppearance,
  parseVoiceAppearance,
  resolveVoiceAppearance,
  type VoiceAppearance,
} from "@nightzeros/chatai-widget-core";

import { MarkdownMessage } from "./markdown-message";
import { VoiceDockSurface, VoiceDockTalk } from "./voice/voice-dock";
import { VoiceExperience, voiceStageVisible } from "./voice/voice-experience";
import { VoiceCompanionCanvas } from "./voice/voice-companion";
import { VoiceGuidedCanvas } from "./voice/voice-guided";
import { MicGlyph, VoiceConsent, VoiceGlyph } from "./voice-ui";

export type WidgetSettings = {
  primaryColor?: string;
  position?: "bottom-left" | "bottom-right";
  theme?: "light" | "dark" | "system";
  iconUrl?: string | null;
  suggestedQuestions?: string[];
  showSources?: boolean;
  voiceAppearance?: VoiceAppearance;
};

export type WidgetAppProps = WidgetControllerOptions &
  WidgetSettings & {
    layout?: "fixed" | "contained";
    /** Set false to hide Voice even when the assistant offers it. */
    voice?: boolean;
  };

type Props = WidgetAppProps;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function settingOverrides(props: Props): WidgetSettings {
  return {
    primaryColor: props.primaryColor,
    position: props.position,
    theme: props.theme,
    iconUrl: props.iconUrl,
    suggestedQuestions: props.suggestedQuestions,
    showSources: props.showSources,
    voiceAppearance: props.voiceAppearance,
  };
}

const EMPTY_STATE: WidgetState = {
  status: "loading",
  messages: [],
  voice: { connection: "idle", phase: "idle" },
};

function settingsFrom(state: WidgetState, props: Props): WidgetSettings {
  const settings = (state.config?.settings ?? {}) as WidgetSettings;
  const overrides = settingOverrides(props);
  const { voiceAppearance: overrideAppearance, ...flatOverrides } = overrides;
  const merged: WidgetSettings = {
    ...settings,
    ...Object.fromEntries(Object.entries(flatOverrides).filter(([, value]) => value !== undefined)),
    theme: props.theme ?? settings.theme ?? "system",
    position: props.position ?? settings.position ?? "bottom-right",
  };
  const appearance = mergeVoiceAppearance(
    parseVoiceAppearance(settings.voiceAppearance),
    overrideAppearance !== undefined ? parseVoiceAppearance(overrideAppearance) : undefined,
  );
  if (Object.keys(appearance).length > 0) merged.voiceAppearance = appearance;
  return merged;
}

/** Resolved Voice presentation for Orb/Classic routing. Classic ignores captionsDefault for layout. */
export function voiceAppearanceFrom(state: WidgetState, props: Props) {
  return resolveVoiceAppearance(settingsFrom(state, props).voiceAppearance);
}

function ChatGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 11.5a7.5 7.5 0 0 1-9.4 7.3L5 21l1.4-4.2A7.5 7.5 0 1 1 20 11.5Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" stroke-linecap="round" />
    </svg>
  );
}

function ThumbUpGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M7 10v12" stroke-linecap="round" stroke-linejoin="round" />
      <path
        d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function ThumbDownGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 14V2" stroke-linecap="round" stroke-linejoin="round" />
      <path
        d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className="chatai-typing" aria-label="Assistant is typing" role="status">
      <span />
      <span />
      <span />
    </div>
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
        signEndpoint: props.signEndpoint,
        voiceMedia: props.voiceMedia,
      }),
    [
      props.assistantId,
      props.apiUrl,
      props.fetch,
      props.storage,
      props.createId,
      props.signEndpoint,
      props.voiceMedia,
    ],
  );
  const [state, setState] = useState<WidgetState>(EMPTY_STATE);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [captionsOpen, setCaptionsOpen] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const wasDockOpenRef = useRef(false);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.load();
    return () => {
      unsubscribe();
      controller.destroy();
    };
  }, [controller]);

  const settings = settingsFrom(state, props);
  const appearance = voiceAppearanceFrom(state, props);
  const questions = settings.suggestedQuestions?.filter(Boolean) ?? [];
  const voiceOn = isVoiceActive(state.voice.connection);
  const voiceOffered = props.voice !== false && Boolean(state.config?.voice?.enabled);
  const isDock = appearance.experience === "dock";
  const isGuided = appearance.experience === "guided";
  const isCompanion = appearance.experience === "companion";
  const isSidePanel = appearance.experience === "side-panel";
  const voiceStage =
    voiceOffered &&
    (appearance.experience === "orb" ||
      appearance.experience === "guided" ||
      appearance.experience === "companion" ||
      appearance.experience === "side-panel") &&
    voiceStageVisible(state.voice);
  const guidedCanvas = voiceOffered && isGuided && !voiceStageVisible(state.voice);
  const companionCanvas = voiceOffered && isCompanion && !voiceStageVisible(state.voice);
  const streaming = state.status === "streaming";
  const busy = streaming || voiceOn;
  const panelShown = open || closing;
  const isDark =
    settings.theme === "dark" ||
    (settings.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches);

  const lastMessage = state.messages[state.messages.length - 1];
  const showTyping = streaming && lastMessage?.role === "assistant" && !lastMessage.content;

  function reduceMotion() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function releaseDockVoice() {
    void controller.endVoice();
    controller.dismissVoiceError();
    if (controller.getState().voice.consentPending) controller.declineRecordingConsent();
  }

  function openPanel() {
    // Dock ↔ text chat mutual exclusion: opening chat ends Dock voice and closes Talk.
    if (dockOpen) {
      releaseDockVoice();
      setDockOpen(false);
    }
    setClosing(false);
    setOpen(true);
  }

  function closePanel() {
    if (!open) return;
    // Closing the chat panel always releases the microphone (Classic/Orb).
    void controller.endVoice();
    if (reduceMotion()) {
      setOpen(false);
      setClosing(false);
      return;
    }
    setOpen(false);
    setClosing(true);
  }

  function togglePanel() {
    if (open) closePanel();
    else openPanel();
  }

  function openDock() {
    // Opening Talk closes the text panel; does not start Voice.
    setOpen(false);
    setClosing(false);
    setDockOpen(true);
  }

  function closeDock() {
    releaseDockVoice();
    setDockOpen(false);
  }

  /** Dock "Back to chat": end voice, close Talk, open the text panel. */
  function dismissDockToChat() {
    releaseDockVoice();
    setDockOpen(false);
    setClosing(false);
    setOpen(true);
  }

  function send(message: string) {
    if (!message.trim()) return;
    setDraft("");
    void controller.send(message);
  }

  function rate(messageId: string, rating: "positive" | "negative") {
    void controller.sendFeedback(messageId, rating).catch(() => undefined);
  }

  function retry() {
    void controller.load();
  }

  function toggleVoice() {
    if (voiceOn) void controller.endVoice();
    else void controller.startVoice();
  }

  useEffect(() => {
    if (!panelShown) return;
    const panel = panelRef.current;
    if (!panel) return;

    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    const initial = focusables();
    (initial.find((el) => el.id === "chatai-message-input") ?? initial[0])?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusables();
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [panelShown, voiceStage]);

  useEffect(() => {
    if (wasOpenRef.current && !open && !closing) {
      launcherRef.current?.focus();
    }
    wasOpenRef.current = open || closing;
  }, [open, closing]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.messages, state.error, showTyping, panelShown]);

  useEffect(() => {
    if (!voiceStage && !dockOpen) setCaptionsOpen(appearance.captionsDefault);
  }, [appearance.captionsDefault, voiceStage, dockOpen]);

  useEffect(() => {
    if (wasDockOpenRef.current && !dockOpen) {
      launcherRef.current?.focus();
    }
    wasDockOpenRef.current = dockOpen;
  }, [dockOpen]);

  // Leave Dock mode if the owner switches experience away from dock while Talk is open.
  useEffect(() => {
    if (!isDock && dockOpen) {
      void controller.endVoice();
      setDockOpen(false);
    }
  }, [isDock, dockOpen, controller]);

  const voiceHandlers = {
    onStart: () => void controller.startVoice(),
    onEnd: () => void controller.endVoice(),
    onMute: (muted: boolean) => controller.setVoiceMicrophoneMuted(muted),
    onToggleCaptions: () => setCaptionsOpen((value) => !value),
    onRetry: () => void controller.startVoice(),
    onDismiss: () => controller.dismissVoiceError(),
    onAcceptConsent: () => void controller.acceptRecordingConsent(),
    onDeclineConsent: () => controller.declineRecordingConsent(),
  };

  return (
    <div
      className={`chatai-widget ${isDark ? "theme-dark" : "theme-light"} ${settings.position === "bottom-left" ? "position-left" : "position-right"} ${props.layout === "contained" ? "layout-contained" : ""}${isDock ? " experience-dock" : ""}${isSidePanel ? " experience-side-panel" : ""}`}
      style={{
        "--chatai-accent": settings.primaryColor ?? "#0F766E",
        ...(appearance.accentColor ? { "--chatai-voice-accent": appearance.accentColor } : {}),
      }}
    >
      {dockOpen && voiceOffered && isDock ? (
        <VoiceDockSurface
          appearance={appearance}
          assistantName={state.config?.name ?? "Assistant"}
          voice={state.voice}
          messages={state.messages}
          levels={() => controller.voiceLevels()}
          captionsOpen={captionsOpen}
          onClose={closeDock}
          onStart={voiceHandlers.onStart}
          onEnd={voiceHandlers.onEnd}
          onMute={voiceHandlers.onMute}
          onToggleCaptions={voiceHandlers.onToggleCaptions}
          onRetry={voiceHandlers.onRetry}
          onDismiss={dismissDockToChat}
          onAcceptConsent={voiceHandlers.onAcceptConsent}
          onDeclineConsent={voiceHandlers.onDeclineConsent}
        />
      ) : null}

      {panelShown ? (
        <section
          ref={panelRef}
          className={`chatai-panel${closing ? " is-closing" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={`${state.config?.name ?? "Assistant"} chat`}
          onAnimationEnd={() => {
            if (closing) setClosing(false);
          }}
        >
          <header className="chatai-header">
            <div>
              <p className="chatai-kicker">{isSidePanel ? "Side panel" : "Knowledge assistant"}</p>
              <h2>{state.config?.name ?? "Loading assistant…"}</h2>
            </div>
            <button type="button" className="chatai-close" onClick={closePanel} aria-label="Close chat">
              ×
            </button>
          </header>

          {voiceStage ? (
            <VoiceExperience
              appearance={appearance}
              assistantName={state.config?.name ?? "Assistant"}
              voice={state.voice}
              messages={state.messages}
              levels={() => controller.voiceLevels()}
              captionsOpen={captionsOpen}
              questions={questions}
              {...voiceHandlers}
            />
          ) : guidedCanvas ? (
            <>
              <VoiceGuidedCanvas
                assistantName={state.config?.name ?? "Assistant"}
                welcomeMessage={state.config?.welcomeMessage}
                questions={questions}
                voiceOffered={voiceOffered}
                busy={busy}
                onStart={() => void controller.startVoice()}
                onAsk={send}
              />
              {state.messages.length > 0 ? (
                <div
                  ref={transcriptRef}
                  className="chatai-transcript chatai-guided-history"
                  aria-live="polite"
                >
                  {state.messages.map((message, index) => {
                    const isVoice = message.modality === "voice";
                    return (
                      <article
                        key={`${message.role}-${index}`}
                        className={`chatai-message ${message.role}${isVoice ? " is-voice" : ""}`}
                      >
                        {isVoice ? (
                          <span className="chatai-voice-tag">
                            <VoiceGlyph />
                          </span>
                        ) : null}
                        {message.role === "assistant" && !isVoice ? (
                          message.content ? (
                            <MarkdownMessage content={message.content} />
                          ) : null
                        ) : (
                          <p className="chatai-user-text">{message.content}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : null}
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
                  placeholder="Or type a question…"
                  maxLength={4000}
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">
                  ↑
                </button>
              </form>
            </>
          ) : companionCanvas ? (
            <>
              <VoiceCompanionCanvas
                assistantName={state.config?.name ?? "Assistant"}
                welcomeMessage={state.config?.welcomeMessage}
                voiceOffered={voiceOffered}
                onStart={() => void controller.startVoice()}
              />
              {state.messages.length > 0 ? (
                <div
                  ref={transcriptRef}
                  className="chatai-transcript chatai-companion-history"
                  aria-live="polite"
                >
                  {state.messages.map((message, index) => {
                    const isVoice = message.modality === "voice";
                    return (
                      <article
                        key={`${message.role}-${index}`}
                        className={`chatai-message ${message.role}${isVoice ? " is-voice" : ""}`}
                      >
                        {isVoice ? (
                          <span className="chatai-voice-tag">
                            <VoiceGlyph />
                          </span>
                        ) : null}
                        {message.role === "assistant" && !isVoice ? (
                          message.content ? (
                            <MarkdownMessage content={message.content} />
                          ) : null
                        ) : (
                          <p className="chatai-user-text">{message.content}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : null}
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
                  placeholder="Or type a message…"
                  maxLength={4000}
                  disabled={busy}
                />
                <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">
                  ↑
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Live Voice captions update per word; the Voice status region announces instead. */}
              <div
                ref={transcriptRef}
                className="chatai-transcript"
                aria-live={voiceOn ? "off" : "polite"}
              >
                {state.config?.welcomeMessage ? (
                  <article className="chatai-message assistant">
                    <MarkdownMessage content={state.config.welcomeMessage} />
                  </article>
                ) : null}
                {questions.length > 0 && state.messages.length === 0 ? (
                  <div className="chatai-prompts">
                    {questions.map((question) => (
                      <button
                        key={question}
                        type="button"
                        onClick={() => send(question)}
                        disabled={busy}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                ) : null}
                {state.messages.map((message, index) => {
                  const isLast = index === state.messages.length - 1;
                  const isStreamingPlaceholder =
                    showTyping && isLast && message.role === "assistant";
                  const isStreamingContent =
                    streaming && isLast && message.role === "assistant" && Boolean(message.content);
                  const isVoice = message.modality === "voice";
                  return (
                    <article
                      key={`${message.role}-${index}`}
                      className={`chatai-message ${message.role}${isVoice ? " is-voice" : ""}${message.live ? " is-live" : ""}`}
                    >
                      {isVoice ? (
                        <span className="chatai-voice-tag">
                          <VoiceGlyph />
                          <span className="chatai-visually-hidden">
                            {message.role === "user" ? "You said:" : "Assistant said:"}
                          </span>
                        </span>
                      ) : null}
                      {isStreamingPlaceholder ? (
                        <TypingIndicator />
                      ) : message.role === "assistant" && !isVoice ? (
                        message.content ? (
                          <MarkdownMessage content={message.content} streaming={isStreamingContent} />
                        ) : (
                          <p>{streaming ? "Thinking…" : ""}</p>
                        )
                      ) : (
                        <p className="chatai-user-text">{message.content}</p>
                      )}
                      {message.interrupted ? <p className="chatai-voice-note">Interrupted</p> : null}
                      {message.role === "assistant" && message.id ? (
                        <div className="chatai-feedback">
                          <span>Was this helpful?</span>
                          <button
                            type="button"
                            aria-label="Mark response helpful"
                            aria-pressed={message.feedback === "positive"}
                            onClick={() => rate(message.id!, "positive")}
                          >
                            <ThumbUpGlyph />
                          </button>
                          <button
                            type="button"
                            aria-label="Mark response not helpful"
                            aria-pressed={message.feedback === "negative"}
                            onClick={() => rate(message.id!, "negative")}
                          >
                            <ThumbDownGlyph />
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {state.error ? (
                  <div className="chatai-error" role="alert">
                    <p>{state.error}</p>
                    <button type="button" className="chatai-retry" onClick={retry} disabled={busy}>
                      Retry
                    </button>
                  </div>
                ) : null}
              </div>

              {voiceOffered && state.voice.consentPending ? (
                <VoiceConsent
                  onAccept={() => void controller.acceptRecordingConsent()}
                  onCancel={() => {
                    controller.declineRecordingConsent();
                    panelRef.current?.querySelector<HTMLElement>("#chatai-message-input")?.focus();
                  }}
                />
              ) : null}
              {voiceOffered && appearance.experience === "classic" ? (
                <VoiceExperience
                  appearance={appearance}
                  assistantName={state.config?.name ?? "Assistant"}
                  voice={state.voice}
                  messages={state.messages}
                  levels={() => controller.voiceLevels()}
                  captionsOpen={captionsOpen}
                  {...voiceHandlers}
                />
              ) : null}

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
                  placeholder={voiceOn ? "Voice is on — end it to type" : "Ask a question…"}
                  maxLength={4000}
                  disabled={busy}
                />
                {voiceOffered && !isDock && !isGuided ? (
                  <button
                    type="button"
                    className={`chatai-mic${voiceOn ? " is-active" : ""}`}
                    onClick={toggleVoice}
                    disabled={streaming}
                    aria-pressed={voiceOn}
                    aria-label={voiceOn ? "End voice conversation" : "Start voice conversation"}
                    title={voiceOn ? "End voice" : "Talk instead"}
                  >
                    <MicGlyph off={voiceOn} />
                  </button>
                ) : null}
                <button type="submit" disabled={busy || !draft.trim()} aria-label="Send message">
                  ↑
                </button>
              </form>
            </>
          )}
        </section>
      ) : null}

      <div className="chatai-launch-row">
        {voiceOffered && isDock ? (
          <VoiceDockTalk open={dockOpen} onOpen={openDock} onClose={closeDock} />
        ) : null}
        <button
          ref={launcherRef}
          type="button"
          className="chatai-launcher"
          onClick={togglePanel}
          aria-label={open || closing ? "Close chat" : "Open chat"}
          aria-expanded={open && !closing}
          aria-haspopup="dialog"
        >
          {settings.iconUrl ? <img src={settings.iconUrl} alt="" /> : <ChatGlyph />}
        </button>
      </div>
    </div>
  );
}
