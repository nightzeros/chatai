import { resolveEffectiveVoicePersistence } from "@chatai/database";
import { DelegationTracker } from "@chatai/voice";

import type { HostingAccount } from "@/lib/hosting/accounts";
import { emptyVoiceCounters, type VoiceRuntimeSession } from "../session-runtime";

/** Test-only runtime factory with safe defaults (no-store, mock provider). */
export function fakeVoiceRuntime(overrides: Partial<VoiceRuntimeSession> = {}): VoiceRuntimeSession {
  const storeConversations = overrides.ephemeral === false;
  return {
    sessionId: "vs_1",
    providerSessionId: "prov_1",
    assistantId: "a1",
    assistantPublicId: "asst_1",
    visitorId: null,
    source: "playground",
    conversationId: null,
    ephemeral: true,
    persistence: resolveEffectiveVoicePersistence(
      { storeConversations },
      { enabled: true, saveTranscripts: true },
    ),
    providerId: "mock",
    model: "gpt-live-1",
    voiceId: "marin",
    status: "connected",
    startedAt: new Date(),
    endedAt: null,
    usageSeconds: 0,
    usageFinalized: false,
    usageIncomplete: false,
    interruptCount: 0,
    errorCode: null,
    inputTranscript: "",
    outputTranscript: "",
    inputFragments: [],
    outputFragments: [],
    consumedInputIndex: 0,
    history: [],
    turns: [],
    liveExchanges: [],
    counters: emptyVoiceCounters(),
    assistant: {
      id: "a1",
      instructions: null,
      hallucinationMode: "balanced",
      ragSettings: null,
      modelSettings: null,
      hostingAccount: { id: "acct_1", status: "active" } as HostingAccount,
    },
    delegations: new DelegationTracker(),
    channel: null,
    provider: {} as VoiceRuntimeSession["provider"],
    unsubscribe: null,
    durableRowInserted: false,
    ttlTimer: null,
    terminating: null,
    recordingConsentAt: null,
    recordingRetentionDays: "off",
    recording: null,
    ...overrides,
  };
}
