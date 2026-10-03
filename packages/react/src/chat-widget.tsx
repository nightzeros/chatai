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
  layout,
  voice,
}: ChatWidgetProps): ReactElement | null {
  const targetRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ onReady, onError });
  const [mounted, setMounted] = useState(false);
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    setMounted(true);
  }, []);

  const suggestedQuestionsKey = JSON.stringify(suggestedQuestions ?? []);

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
        primaryColor,
        position,
        theme,
        iconUrl,
        suggestedQuestions,
        showSources,
        layout,
        voice,
      });
      callbacksRef.current.onReady?.();
      return () => instance.destroy();
    } catch (error) {
      callbacksRef.current.onError?.(errorFrom(error));
    }
  }, [
    assistantId,
    apiUrl,
    fetchImpl,
    storage,
    createId,
    signEndpoint,
    primaryColor,
    position,
    theme,
    iconUrl,
    suggestedQuestionsKey,
    showSources,
    layout,
    voice,
    mounted,
  ]);

  if (!mounted) return null;

  return <div ref={targetRef} className={className} />;
}
