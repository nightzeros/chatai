"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import { mountChatWidget, type ChatWidgetOptions } from "./client";

export type ChatWidgetProps = ChatWidgetOptions & {
  className?: string;
  onReady?: () => void;
  onError?: (error: Error) => void;
};

function errorFrom(error: unknown) {
  return error instanceof Error ? error : new Error("Widget mount failed.");
}

/**
 * Presentation fields can update without remounting (keeps an active Voice session).
 * Identity / transport fields still remount the widget.
 */
function presentationFrom(props: ChatWidgetOptions): Partial<ChatWidgetOptions> {
  return {
    primaryColor: props.primaryColor,
    position: props.position,
    theme: props.theme,
    iconUrl: props.iconUrl,
    suggestedQuestions: props.suggestedQuestions,
    showSources: props.showSources,
    voiceAppearance: props.voiceAppearance,
    layout: props.layout,
    voice: props.voice,
  };
}

export function ChatWidget({
  className,
  onReady,
  onError,
  assistantId,
  apiUrl,
  fetch: fetchImpl,
  storage,
  createId,
  signEndpoint,
  primaryColor,
  position,
  theme,
  iconUrl,
  suggestedQuestions,
  showSources,
  voiceAppearance,
  layout,
  voice,
  voiceMedia,
}: ChatWidgetProps): ReactElement | null {
  const targetRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReturnType<typeof mountChatWidget> | null>(null);
  const callbacksRef = useRef({ onReady, onError });
  const [mounted, setMounted] = useState(false);
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    setMounted(true);
  }, []);

  const suggestedQuestionsKey = JSON.stringify(suggestedQuestions ?? []);
  const voiceAppearanceKey = JSON.stringify(voiceAppearance ?? null);

  // Remount only when the controller identity would change.
  useEffect(() => {
    if (!mounted || !targetRef.current) return;

    try {
      const instance = mountChatWidget(targetRef.current, {
        assistantId,
        apiUrl,
        fetch: fetchImpl,
        storage,
        createId,
        signEndpoint,
        voiceMedia,
        ...presentationFrom({
          assistantId,
          apiUrl,
          primaryColor,
          position,
          theme,
          iconUrl,
          suggestedQuestions,
          showSources,
          voiceAppearance,
          layout,
          voice,
        }),
      });
      instanceRef.current = instance;
      callbacksRef.current.onReady?.();
      return () => {
        instance.destroy();
        instanceRef.current = null;
      };
    } catch (error) {
      callbacksRef.current.onError?.(errorFrom(error));
    }
    // Intentionally omit presentation props — they update via the effect below.
  }, [
    assistantId,
    apiUrl,
    fetchImpl,
    storage,
    createId,
    signEndpoint,
    voiceMedia,
    mounted,
  ]);

  useEffect(() => {
    instanceRef.current?.update(
      presentationFrom({
        assistantId,
        apiUrl,
        primaryColor,
        position,
        theme,
        iconUrl,
        suggestedQuestions,
        showSources,
        voiceAppearance,
        layout,
        voice,
      }),
    );
  }, [
    primaryColor,
    position,
    theme,
    iconUrl,
    suggestedQuestionsKey,
    showSources,
    voiceAppearanceKey,
    layout,
    voice,
    assistantId,
    apiUrl,
  ]);

  if (!mounted) return null;

  return <div ref={targetRef} className={className} />;
}
