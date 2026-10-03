"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { createPlaybackScope, type PlaybackScope } from "@/lib/voice/recording/exclusive-playback";

const PlaybackScopeContext = createContext<PlaybackScope | null>(null);

/** Recordings rendered inside share one scope: starting one pauses the others. */
export function RecordingPlaybackScope({ children }: { children: ReactNode }) {
  const [scope] = useState(createPlaybackScope);
  return <PlaybackScopeContext.Provider value={scope}>{children}</PlaybackScopeContext.Provider>;
}

export function usePlaybackScope(): PlaybackScope | null {
  return useContext(PlaybackScopeContext);
}
