import {
  assistants,
  conversations,
  eq,
  resolveEffectiveVoicePersistence,
  resolveVoiceSettings,
  type ConversationSource,
} from "@chatai/database";
import { loadAssistantContext } from "@chatai/rag/answer";
import { DelegationTracker } from "@chatai/voice";
import { z } from "zod";

import { usesApiKeyAuth } from "@/lib/api-keys";
import { getOwnedAssistantByRef } from "@/lib/assistants";
import { authorizeV1 } from "@/lib/authorize-v1";
import {
  clientHistorySchema,
  fromClientHistory,
  withServerGrounding,
} from "@/lib/conversation-history";
import { corsHeaders, jsonWithCors } from "@/lib/cors";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import {
  checkHostingAccountAccess,
  resolveBillableAccountForAssistant,
} from "@/lib/hosting/accounts";
import { createId } from "@/lib/ids";
import { policyViolationResponse } from "@/lib/policies/policy-response";
import { SecurityPolicy } from "@/lib/policies/security-policy";
import { consumeApiKeyRateLimit } from "@/lib/rate-limit";
import {
  admitVoiceSession,
  armVoiceRuntimeTtl,
  assertPlaygroundOwner,
  assertVoiceNotDraining,
  detectServerlessPlatform,
  finishVoiceRecording,
  isVoiceDraining,
  logVoiceEvent,
  trackVoiceMint,
  VoiceDrainingError,
  buildVoiceSessionConfig,
  canPersistVoiceContent,
  cleanupFailedMint,
  confirmBrowserCommandLock,
  createVoiceControlToken,
  createVoiceConversation,
  createVoiceMeter,
  createVoiceProvider,
  emptyVoiceCounters,
  insertDurableVoiceSessionRow,
  insertOperationalVoiceSessionRow,
  isSupportedVoiceProvider,
  loadConversationHistory,
  markVoiceProviderCreated,
  markVoiceSessionConnected,
  recordingApplies,
  recordingConsentRequired,
  registerVoiceRuntime,
  releaseVoiceAdmission,
  logVoiceWarning,
  settleVoiceUsage,
  startVoiceMeter,
  startVoiceRecording,
  startVoiceSupervision,
  voiceControlSettings,
  resolveVoiceProviderCredentials,
  resolveVoiceProviderKind,
  superviseSideband,
  supersedeVisitorVoiceSessions,
  type VoiceHistoryTurn,
  type VoiceProviderCredentials,
  type VoiceRefusalReason,
  type VoiceRuntimeSession,
  writeLifecycleVoiceEvent,
} from "@/lib/voice";

const bodySchema = z.object({
  assistantId: z.string().min(1, "assistantId is required"),
  // Never trim: SDP lines are CRLF-terminated and providers reject a truncated final line.
  sdpOffer: z
    .string()
    .max(256_000)
    .refine((value) => value.trim().length > 0, "sdpOffer is required"),
  visitorId: z.string().min(1).max(80).optional(),
  conversationId: z.string().min(1).optional(),
  source: z.enum(["playground", "widget", "api"]).optional(),
  recordingConsent: z.boolean().optional(),
  /** Recent turns held by the client; used when the server has none stored. */
  history: clientHistorySchema.optional(),
  /** `heartbeat`: the client sends control heartbeats and gets a `controlToken`. */
  capabilities: z.array(z.enum(["heartbeat"])).max(4).optional(),
});

/** Bound on waiting for the provider's session.started (it normally arrives at attach). */
const BROWSER_LOCK_CONFIRM_TIMEOUT_MS = 3_000;

const VOICE_UNAVAILABLE = { error: "Voice isn't available right now.", reason: "voice_unavailable" } as const;

/** The provider did not confirm the browser command lock: the session must not run. */
class BrowserCommandLockError extends Error {
  constructor() {
    super("browser_command_lock_unconfirmed");
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/v1/voice/sessions — mint a Topology B WebRTC voice session.
 *
 * Security order (widget path): domain → rate → bot → HMAC (via SecurityPolicy).
 * Persistence is resolved before any durable conversational write.
 * OpenAI project credentials never leave the server.
 * Voice needs a long-lived Node runtime: serverless platforms and a draining
 * (shutting down) process refuse with the neutral `voice_unavailable`.
 */
export async function POST(request: Request) {
  const serverless = detectServerlessPlatform();
  if (serverless) {
    logVoiceWarning("mint.refused", { code: "serverless_unsupported", platform: serverless });
    return jsonWithCors(VOICE_UNAVAILABLE, { status: 503 });
  }
  if (isVoiceDraining()) {
    logVoiceEvent("mint.refused", { code: "draining" });
    return jsonWithCors(VOICE_UNAVAILABLE, { status: 503 });
  }
  return trackVoiceMint(() => mintVoiceSession(request));
}

async function mintVoiceSession(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const source: ConversationSource = input.source ?? "api";

  let assistant;
  if (usesApiKeyAuth(request)) {
    // Dedicated scope: existing `chat` keys cannot mint realtime voice sessions.
    const auth = await authorizeV1(request, ["voice"]);
    if (!auth.ok) {
      return jsonWithCors({ error: auth.error }, { status: auth.status });
    }

    const limited = await consumeApiKeyRateLimit(auth.apiKeyId);
    if (!limited.ok) {
      return jsonWithCors(
        { error: "Rate limit exceeded." },
        { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
      );
    }

    assistant = await getOwnedAssistantByRef(auth.userId, input.assistantId);
    if (!assistant) {
      return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
    }
  } else {
    const [row] = await db()
      .select()
      .from(assistants)
      .where(eq(assistants.publicId, input.assistantId))
      .limit(1);
    assistant = row;
  }

  if (!assistant) {
    return jsonWithCors({ error: "Assistant not found." }, { status: 404 });
  }

  // Spoofed `source: "playground"` must not skip widget security.
  if (!usesApiKeyAuth(request)) {
    const playground = await assertPlaygroundOwner({
      source,
      assistantOwnerId: assistant.userId,
    });
    if (!playground.ok) {
      return jsonWithCors({ error: playground.error }, { status: playground.status });
    }
  }

  const hostingAccount = await resolveBillableAccountForAssistant(assistant);
  const hostingAccess = checkHostingAccountAccess(hostingAccount);
  if (!hostingAccess.ok) {
    return jsonWithCors({ error: hostingAccess.error }, { status: hostingAccess.status });
  }

  // Widget security — same SecurityPolicy as chat (no parallel gates).
  // domain → rate limits → bot heuristics → optional HMAC.
  if (!usesApiKeyAuth(request)) {
    const security = SecurityPolicy.fromAssistant(assistant, env);
    const violation = await security.enforceWidgetRequest(request, {
      visitorId: input.visitorId,
      // No chat message at mint; content-based bot checks are skipped by the policy.
      source,
    });
    if (violation) {
      return policyViolationResponse(violation);
    }
  }

  // Checked after security so disallowed origins cannot probe Voice config.
  // `enabled` governs public surfaces (widget/API); the verified owner may always
  // prototype in the playground.
  const voiceResolved = resolveVoiceSettings(assistant.voiceSettings);
  if (!voiceResolved.enabled && source !== "playground") {
    return jsonWithCors({ error: "Voice is not enabled for this assistant." }, { status: 403 });
  }
  if (!isSupportedVoiceProvider(assistant.voiceSettings)) {
    return jsonWithCors({ error: "Configured voice provider is not supported." }, { status: 503 });
  }

  // Resolve persistence BEFORE any durable conversational write.
  // Global no-store wins everywhere, including the owner playground.
  const persistence = resolveEffectiveVoicePersistence(
    assistant.privacySettings,
    assistant.voiceSettings,
  );

  // Prior turns use the same semantics as text chat. The session binds (writes) only
  // to a durable conversation; a no-store owner playground session may read the
  // stored playground text turns but never writes.
  let history: VoiceHistoryTurn[] = [];
  if (input.conversationId && (!persistence.ephemeral || source === "playground")) {
    const [existing] = await db()
      .select({ id: conversations.id, assistantId: conversations.assistantId })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    const owned = existing && existing.assistantId === assistant.id;
    if (!owned && !persistence.ephemeral) {
      return jsonWithCors({ error: "Conversation not found." }, { status: 404 });
    }
    if (owned) history = await loadConversationHistory(existing.id);
  }
  // Client-held turns count only when nothing is stored (no-store text, earlier
  // ephemeral Voice) and are never grounded. With storage on, stored turns are the
  // only history, so unsaved Voice turns (transcripts off) never outlive their session.
  if (persistence.ephemeral) {
    const clientHistory = fromClientHistory(input.history);
    if (history.length === 0) {
      history = clientHistory;
    } else if (clientHistory.length > 0) {
      history = withServerGrounding(clientHistory, history);
    }
  }

  // Recording needs storage on, "Record Voice audio" on and configured object storage;
  // widget/playground visitors must have accepted the disclosure before mic + mint.
  const recording = recordingApplies(persistence);
  if (recording && recordingConsentRequired(source, voiceResolved) && !input.recordingConsent) {
    return jsonWithCors(
      { error: "Recording consent is required before starting a recorded voice session." },
      { status: 400 },
    );
  }

  // Voice credentials come from the Voice configuration layer, independent of the
  // assistant's text provider.
  const providerKind = resolveVoiceProviderKind(env.VOICE_PROVIDER);
  let credentials: VoiceProviderCredentials | null = null;
  if (providerKind === "gpt-live") {
    credentials = resolveVoiceProviderCredentials();
    if (!credentials) {
      return jsonWithCors(
        { error: "Voice provider is not configured on this instance." },
        { status: 503 },
      );
    }
  }

  let provider;
  try {
    provider = await createVoiceProvider({ kind: providerKind, credentials });
  } catch (err) {
    return jsonWithCors(
      {
        error:
          err instanceof Error ? err.message : "Failed to initialize voice provider.",
      },
      { status: 503 },
    );
  }

  const assistantContext = await loadAssistantContext(db(), assistant.id);
  const sessionConfig = buildVoiceSessionConfig({
    assistantName: assistant.name,
    assistantInstructions: assistant.instructions,
    assistantDescription: assistant.description,
    purpose: assistantContext.purpose,
    voiceSettings: assistant.voiceSettings,
    // Text→voice continuity: seed the live model with prior turns.
    history: history.map((turn) => ({ role: turn.role, text: turn.content })),
  });

  const sessionId = createId();
  const visitorId = input.visitorId ?? null;

  // One active widget session per visitor: end the previous one before counting.
  await supersedeVisitorVoiceSessions({ assistantId: assistant.id, visitorId, source });

  // Quota + concurrency admission before provider billing can start.
  const admitted = await admitVoiceSession({
    sessionId,
    assistantId: assistant.id,
    account: hostingAccount,
    source,
    visitorId,
    ephemeral: persistence.ephemeral,
    providerId: provider.id,
    model: sessionConfig.model,
    voiceId: sessionConfig.voice,
  });
  if (!admitted.ok) {
    // Widget visitors get one neutral refusal: no quota/minutes reason, no 402.
    if (source === "widget") {
      return jsonWithCors(
        { error: "Voice isn't available right now.", reason: "voice_unavailable" },
        { status: 403 },
      );
    }
    return jsonWithCors(
      { error: voiceRefusalMessage(admitted.reason), reason: admitted.reason },
      { status: admitted.status },
    );
  }

  let providerSessionId: string | null = null;
  let channel = null as Awaited<ReturnType<typeof provider.attachControlChannel>> | null;
  let runtime: VoiceRuntimeSession | null = null;

  try {
    assertVoiceNotDraining();
    const created = await provider.createWebRtcSession({
      sdpOffer: input.sdpOffer,
      sessionConfig,
      correlationId: sessionId,
    });
    providerSessionId = created.providerSessionId;
    // Provider billing has started: the metering row now points at a real session.
    const startedAt = new Date();
    await markVoiceProviderCreated({
      sessionId,
      providerSessionId: created.providerSessionId,
      startedAt,
    });

    // Durable + transcripts on: voice turns land in a conversation the user can
    // continue by text. No-store never creates one. With transcripts off, an existing
    // conversation is only read for context; Voice turns stay in runtime memory.
    // A recorded session always needs a conversation to hold the recording (with
    // transcripts off it has no Voice messages).
    let conversationId: string | null = null;
    if (!persistence.ephemeral) {
      conversationId =
        input.conversationId ??
        (persistence.saveTranscripts || recording
          ? await createVoiceConversation({
              assistantId: assistant.id,
              visitorId: input.visitorId ?? null,
              source,
            })
          : null);
    }

    // No await between attach and superviseSideband: the provider sends
    // session.started (the browser-lock confirmation) right after attach, and an
    // event emitted before anyone subscribes is lost.
    channel = await provider.attachControlChannel(created.providerSessionId);

    runtime = {
      sessionId,
      providerSessionId: created.providerSessionId,
      assistantId: assistant.id,
      assistantPublicId: assistant.publicId,
      visitorId,
      source,
      conversationId,
      ephemeral: persistence.ephemeral,
      persistence,
      providerId: provider.id,
      model: sessionConfig.model,
      voiceId: sessionConfig.voice,
      status: "connecting",
      startedAt,
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
      history,
      turns: [],
      liveExchanges: [],
      counters: emptyVoiceCounters(),
      assistant: {
        id: assistant.id,
        name: assistant.name,
        description: assistant.description,
        instructions: assistant.instructions,
        hallucinationMode: assistant.hallucinationMode,
        ragSettings: assistant.ragSettings,
        modelSettings: assistant.modelSettings,
        hostingAccount,
      },
      delegations:
        "delegations" in channel && channel.delegations instanceof DelegationTracker
          ? channel.delegations
          : new DelegationTracker(),
      channel,
      provider,
      unsubscribe: null,
      durableRowInserted: false,
      ttlTimer: null,
      terminating: null,
      recordingConsentAt: recording && input.recordingConsent ? new Date() : null,
      recordingRetentionDays: voiceResolved.recordingRetentionDays,
      recording: null,
      metering: createVoiceMeter(admitted.admission),
      endReason: null,
    };

    // Subscribe before any await so early transcript/delegation events are not missed.
    superviseSideband(runtime, channel);

    // Security invariant: the browser data channel must not be able to steer the
    // provider session. Only an explicit provider confirmation lets the call run.
    if (!(await confirmBrowserCommandLock(runtime, channel, BROWSER_LOCK_CONFIRM_TIMEOUT_MS))) {
      throw new BrowserCommandLockError();
    }

    // Store on: durable session metadata; voice turns become messages when transcripts are on.
    // No-store: minimal operational row only (ephemeral=true, conversationId=null,
    // no voice_events, no messages). Conversational state stays in memory.
    if (persistence.ephemeral) {
      await insertOperationalVoiceSessionRow(runtime);
    } else {
      await insertDurableVoiceSessionRow(runtime);
    }
    // Best-effort: a recorder that cannot start leaves the Voice session unaffected.
    const recorded = recording ? await startVoiceRecording(runtime) : false;
    if (runtime.status === "connected") {
      // session.started usually arrives during attach, before the durable row exists.
      await markVoiceSessionConnected(runtime).catch(() => undefined);
      await writeLifecycleVoiceEvent(runtime, "session.started", {
        providerSessionId: runtime.providerSessionId,
      }).catch(() => undefined);
    }

    // Heartbeats are opt-in: clients that never declared them are never ended for missing ones.
    const controlToken = input.capabilities?.includes("heartbeat")
      ? createVoiceControlToken({ sessionId, visitorId })
      : null;

    // Same tick as registration: a drain that began during this mint never misses the session.
    assertVoiceNotDraining();
    registerVoiceRuntime(runtime);
    armVoiceRuntimeTtl(runtime);
    startVoiceMeter(runtime);
    startVoiceSupervision(runtime, { heartbeatCapable: Boolean(controlToken) });

    // Never include API keys or signing secrets.
    return jsonWithCors({
      sessionId,
      sdpAnswer: created.sdpAnswer,
      /** Correlation only — not a credential; media stays browser↔provider. */
      providerSessionId: created.providerSessionId,
      ephemeral: persistence.ephemeral,
      transcriptSaved: canPersistVoiceContent(runtime),
      recording: recorded,
      conversationId,
      model: sessionConfig.model,
      voiceId: sessionConfig.voice,
      ...(controlToken
        ? { controlToken, heartbeatIntervalMs: voiceControlSettings().heartbeatIntervalMs }
        : {}),
    });
  } catch (err) {
    // Detach the supervisor first: the cleanup's session.closed must not run the
    // normal termination path for a session that never became live.
    runtime?.unsubscribe?.();
    if (runtime) runtime.unsubscribe = null;
    if (providerSessionId) {
      // A created provider session is always ended (hangup), never left unsupervised.
      await cleanupFailedMint({ provider, channel, providerSessionId });
    }
    // Only a drain refusal can land here after the recorder started.
    if (runtime?.recording) void finishVoiceRecording(runtime);

    const draining = err instanceof VoiceDrainingError;
    const lockFailure = err instanceof BrowserCommandLockError || isBrowserLockRejection(err);
    logVoiceWarning("mint.failed", {
      sessionId,
      source,
      code: draining
        ? "draining"
        : lockFailure
          ? err instanceof BrowserCommandLockError
            ? "browser_command_lock_unconfirmed"
            : "browser_command_lock_rejected"
          : providerSessionId
            ? "post_create_failure"
            : "provider_create_failed",
      providerStatus: providerStatusOf(err),
      providerSessionCreated: Boolean(providerSessionId),
    });

    // After provider create: 0 Voice seconds, provider init cost still accounted.
    // Before it: no meter at all (grant returned, row removed).
    try {
      if (providerSessionId) {
        await settleVoiceUsage({
          sessionId,
          measurement: "none",
          providerSeconds: 0,
          finalizeRow: { status: "failed", errorCode: draining ? "shutdown" : "mint_failed" },
        });
      } else {
        await releaseVoiceAdmission(sessionId);
      }
    } catch (meterError) {
      console.error("[voice] mint cleanup metering failed", {
        sessionId,
        error: meterError instanceof Error ? meterError.message : String(meterError),
      });
    }

    if (draining) return jsonWithCors(VOICE_UNAVAILABLE, { status: 503 });
    // Visitors never see provider or internal details; neither does anyone for the
    // browser command lock. Owners keep a sanitized cause for other failures.
    if (source === "widget" || lockFailure) {
      return jsonWithCors(VOICE_UNAVAILABLE, { status: 502 });
    }
    return jsonWithCors(
      {
        error:
          err instanceof Error
            ? sanitizeProviderError(err.message)
            : "Failed to create voice session.",
      },
      { status: 502 },
    );
  }
}

/** The provider refused the create body because of the browser command policy field. */
function isBrowserLockRejection(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /\b4\d\d\b/.test(err.message) && /allowed_client_events|data_channel|session\.client/.test(err.message);
}

/** HTTP status embedded in an adapter error ("… failed (400): …"); never the body. */
function providerStatusOf(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = /\((\d{3})\)/.exec(err.message);
  return match ? Number(match[1]) : null;
}

/** Visitors get neutral copy (no plan details); owners (playground / API key) get the cause. */
function voiceRefusalMessage(reason: VoiceRefusalReason): string {
  return reason === "voice_minutes_exhausted"
    ? "This account's Voice minutes for the current period are used up."
    : "Too many Voice sessions are active for this account. End one and try again.";
}

function sanitizeProviderError(message: string): string {
  // Avoid leaking request URLs that might include secrets in pathological setups.
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}
