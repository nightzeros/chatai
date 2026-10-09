"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, PhoneOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { createPlaygroundControl, type PlaygroundControl, type PlaygroundControlView } from "./playground-control";
import {
  deriveVoicePhase,
  detectInterruption,
  isAssistantActive,
  isPlaygroundVoiceActive,
  isUserActive,
  ownerControlDetail,
  VOICE_END_NOTICE_DISCONNECTED,
  VOICE_PHASE_LABELS,
  voiceEndNotice,
  type OwnerControlView,
  type VoiceConnection,
  type VoicePhase,
  type VoiceSignals,
} from "./voice-state";

export type PlaygroundVoiceConfig = {
  /** Internal assistant id (owner-only debug endpoint). */
  assistantId: string;
  available: boolean;
  mockProvider: boolean;
  /** Voice on public surfaces (widget/API). The owner can always test here. */
  publicEnabled: boolean;
  ephemeral: boolean;
  saveTranscripts: boolean;
  /** Sessions would be recorded: show the disclosure before the mic is requested. */
  recording: boolean;
};

export type CompletedVoiceTurn = {
  id: string;
  /** delegated: answered through ChatAI; live: GPT-Live answered itself; superseded: no answer. */
  kind: "delegated" | "live" | "superseded";
  question: string;
  answer: string;
  interrupted: boolean;
};

type DebugExchange = CompletedVoiceTurn & { startMs: number; settled: boolean };

export type ClientHistoryMessage = { role: "user" | "assistant"; content: string };

type Caption = { id: string; role: "user" | "assistant" | "system"; text: string };

type DebugTurn = {
  id: string;
  origin: "delegation" | "server";
  delegationId: string | null;
  status: string;
  userText: string;
  historySupplied: number | null;
  rewrittenQuery: string | null;
  retrieval: {
    action: "generate" | "fallback";
    contextSufficient: boolean;
    chunks: Array<{ documentName: string; similarity: number; preview: string }>;
  } | null;
  groundedAnswer: string | null;
  answerText: string | null;
  commentary: {
    eventId: string | null;
    acknowledged: boolean;
    ackStartMs: number | null;
    rejectReason: string | null;
  };
  spokenText: string;
  interrupted: boolean;
  supersededBy: string | null;
  lateResultDiscarded: boolean;
  outcome: string | null;
  sources: string[];
  error: string | null;
  metrics: {
    utteranceReadyMs: number | null;
    ragStartMs: number | null;
    ragDurationMs: number | null;
    generateDurationMs: number | null;
    firstCommentaryMs: number | null;
    commentaryAckMs: number | null;
    firstSpeechMs: number | null;
  };
};

type DebugSnapshot = {
  sessionId: string;
  status: string;
  ephemeral: boolean;
  conversationId: string | null;
  interruptCount: number;
  historyTurns: number;
  counters: Record<string, number>;
  control?: OwnerControlView["sideband"];
  turns: DebugTurn[];
  exchanges: DebugExchange[];
};

const MIC_RMS_THRESHOLD = 0.02;
const REMOTE_RMS_THRESHOLD = 0.01;
const TICK_MS = 100;
const POLL_MS = 1_000;
const ICE_GATHER_TIMEOUT_MS = 4_000;
const IN_FLIGHT = new Set(["collecting", "retrieving", "generating"]);

const PHASE_TONE: Record<VoicePhase, string> = {
  idle: "bg-muted-foreground/40",
  connecting: "bg-amber-500 animate-pulse",
  listening: "bg-emerald-500",
  user_speaking: "bg-sky-500 animate-pulse",
  delegating: "bg-violet-500 animate-pulse",
  assistant_speaking: "bg-emerald-600 animate-pulse",
  interrupted: "bg-orange-500",
  reconnecting: "bg-amber-500 animate-pulse",
  control_lost: "bg-amber-600 animate-pulse",
  error: "bg-destructive",
  ended: "bg-muted-foreground/40",
};

function waitForIceGathering(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }
    function check() {
      if (pc.iceGatheringState === "complete") done();
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function rms(analyser: AnalyserNode | null, buffer: Float32Array<ArrayBuffer> | null) {
  if (!analyser || !buffer) return 0;
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (const sample of buffer) sum += sample * sample;
  return Math.sqrt(sum / buffer.length);
}

function ms(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${Math.round(value)} ms`;
}

export function VoicePanel({
  publicId,
  config,
  conversationId,
  visitorId,
  onConversation,
  onActiveChange,
  onTurnsCompleted,
  history,
}: {
  publicId: string;
  config: PlaygroundVoiceConfig;
  conversationId: string | undefined;
  visitorId: () => string;
  /** Recent turns shown in the chat; the server uses them only when nothing is stored (no-store). */
  history: () => ClientHistoryMessage[];
  onConversation: (conversationId: string) => void;
  onActiveChange: (active: boolean) => void;
  onTurnsCompleted: (turns: CompletedVoiceTurn[]) => void;
}) {
  const [connection, setConnection] = useState<VoiceConnection>("idle");
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
  const [browserFirstAudio, setBrowserFirstAudio] = useState<Record<string, number>>({});
  const [browserInterrupts, setBrowserInterrupts] = useState(0);
  const [sessionMode, setSessionMode] = useState<{ ephemeral: boolean; recording: boolean } | null>(null);
  const [consentPending, setConsentPending] = useState(false);
  const [controlView, setControlView] = useState<PlaygroundControlView | null>(null);
  /** Consent given for the current call; a reconnect continues the same call. */
  const consentRef = useRef(false);
  const controlRef = useRef<PlaygroundControl | null>(null);
  const endForControlRef = useRef<(notice: string) => void>(() => undefined);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyser = useRef<{ node: AnalyserNode; buffer: Float32Array<ArrayBuffer> } | null>(null);
  const remoteAnalyser = useRef<{ node: AnalyserNode; buffer: Float32Array<ArrayBuffer> } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const connectionRef = useRef<VoiceConnection>("idle");
  const signals = useRef<VoiceSignals>({
    connection: "idle",
    now: 0,
    userVoiceAt: null,
    assistantVoiceAt: null,
    delegationActive: false,
    interruptedAt: null,
  });
  const userWasActive = useRef(false);
  const pendingDelegations = useRef(new Map<string, number>());
  const firstAudioRecorded = useRef(new Set<string>());
  const snapshotRef = useRef<DebugSnapshot | null>(null);
  const reported = useRef(new Set<string>());

  const updateConnection = useCallback(
    (next: VoiceConnection) => {
      connectionRef.current = next;
      signals.current.connection = next;
      setConnection(next);
      onActiveChange(isPlaygroundVoiceActive(next));
    },
    [onActiveChange],
  );

  const appendCaption = useCallback((role: Caption["role"], text: string) => {
    if (!text) return;
    setCaptions((current) => {
      const last = current.at(-1);
      if (last && last.role === role && role !== "system") {
        return [...current.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...current.slice(-80), { id: crypto.randomUUID(), role, text }];
    });
  }, []);

  const markAssistantAudio = useCallback((now: number) => {
    signals.current.assistantVoiceAt = now;
    for (const [delegationId, startedAt] of pendingDelegations.current) {
      if (firstAudioRecorded.current.has(delegationId)) continue;
      firstAudioRecorded.current.add(delegationId);
      setBrowserFirstAudio((current) => ({ ...current, [delegationId]: now - startedAt }));
    }
  }, []);

  const handleProviderEvent = useCallback(
    (event: { type?: string; delta?: string; delegation?: { id?: string }; error?: { message?: string } }) => {
      const now = performance.now();
      if (connectionRef.current === "degraded") {
        // Unsupervised provider activity is not shown while ChatAI control is unavailable.
        if (event.type === "session.closed") endForControlRef.current(VOICE_END_NOTICE_DISCONNECTED);
        return;
      }
      switch (event.type) {
        case "session.started":
          updateConnection("connected");
          break;
        case "session.input_transcript.delta":
          signals.current.userVoiceAt = now;
          appendCaption("user", event.delta ?? "");
          break;
        case "session.output_transcript.delta":
          markAssistantAudio(now);
          appendCaption("assistant", event.delta ?? "");
          break;
        case "session.delegation.created": {
          const id = event.delegation?.id;
          if (id) pendingDelegations.current.set(id, now);
          signals.current.delegationActive = true;
          appendCaption("system", "Delegated to ChatAI");
          break;
        }
        case "session.closed":
          updateConnection("ended");
          break;
        case "error":
          setError(event.error?.message ?? "Voice provider error.");
          break;
      }
    },
    [appendCaption, markAssistantAudio, updateConnection],
  );

  /** Adds every exchange to the chat in spoken order; `final` includes the still-open one. */
  const reportCompletedTurns = useCallback(
    (latest: DebugSnapshot | null, final = false) => {
      if (!latest) return;
      // Exchange ids come from the provider timeline, which restarts every session.
      const completed = (latest.exchanges ?? [])
        .map((exchange) => ({ ...exchange, id: `${latest.sessionId}:${exchange.id}` }))
        .filter((exchange) => (final || exchange.settled) && !reported.current.has(exchange.id))
        .map(({ id, kind, question, answer, interrupted }) => {
          reported.current.add(id);
          return { id, kind, question, answer, interrupted };
        });
      if (completed.length) onTurnsCompleted(completed);
    },
    [onTurnsCompleted],
  );

  const teardown = useCallback(() => {
    controlRef.current?.stop();
    controlRef.current = null;
    pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    micRef.current?.getTracks().forEach((track) => track.stop());
    micRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    micAnalyser.current = null;
    remoteAnalyser.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    pendingDelegations.current.clear();
    signals.current = { ...signals.current, userVoiceAt: null, assistantVoiceAt: null, delegationActive: false, interruptedAt: null };
  }, []);

  const endServerSession = useCallback(
    async (reason: "close_requested" | "connection_lost" | "error") => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (!sessionId) return null;
      const response = await fetch(`/api/v1/voice/sessions/${sessionId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, visitorId: visitorId(), source: "playground" }),
        keepalive: true,
      }).catch(() => null);
      if (!response?.ok) return null;
      const body = (await response.json().catch(() => null)) as { endReason?: unknown } | null;
      const endNotice = voiceEndNotice(body?.endReason);
      if (endNotice) setNotice(endNotice);
      return endNotice;
    },
    [visitorId],
  );

  const pollSnapshot = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return null;
    const response = await fetch(
      `/api/assistants/${config.assistantId}/voice-sessions/${sessionId}`,
      { cache: "no-store" },
    ).catch(() => null);
    if (!response?.ok) return null;
    const next = (await response.json()) as DebugSnapshot;
    snapshotRef.current = next;
    setSnapshot(next);
    for (const turn of next.turns) {
      if (!IN_FLIGHT.has(turn.status) && turn.delegationId) pendingDelegations.current.delete(turn.delegationId);
    }
    const knownIds = new Set(next.turns.flatMap((turn) => (turn.delegationId ? [turn.delegationId] : [])));
    signals.current.delegationActive =
      next.turns.some((turn) => IN_FLIGHT.has(turn.status)) ||
      [...pendingDelegations.current.keys()].some((id) => !knownIds.has(id));
    reportCompletedTurns(next);
    return next;
  }, [config.assistantId, reportCompletedTurns]);

  const stop = useCallback(
    async (reason: "close_requested" | "connection_lost" | "error" = "close_requested") => {
      await pollSnapshot();
      await endServerSession(reason);
      teardown();
      reportCompletedTurns(snapshotRef.current, true);
      updateConnection("ended");
    },
    [endServerSession, pollSnapshot, reportCompletedTurns, teardown, updateConnection],
  );

  const setControlMuted = useCallback(
    (muted: boolean) => {
      // Disable (never stop) the mic track so media keeps flowing with packet timing intact.
      micRef.current?.getTracks().forEach((track) => {
        track.enabled = !muted;
      });
      if (audioRef.current) audioRef.current.muted = muted;
      if (muted) {
        signals.current = { ...signals.current, userVoiceAt: null, assistantVoiceAt: null, interruptedAt: null };
        userWasActive.current = false;
        updateConnection("degraded");
      } else if (connectionRef.current === "degraded") {
        updateConnection("connected");
      }
    },
    [updateConnection],
  );

  /** Control stayed lost (or ChatAI ended the call): close media, one best-effort end. */
  const endForControl = useCallback(
    (endNotice: string) => {
      if (!pcRef.current && !sessionIdRef.current) return;
      teardown();
      setError(null);
      setNotice(endNotice);
      // Clears the session id synchronously, so the "ended" effect does not end it again.
      void endServerSession("connection_lost");
      reportCompletedTurns(snapshotRef.current, true);
      updateConnection("ended");
    },
    [endServerSession, reportCompletedTurns, teardown, updateConnection],
  );

  useEffect(() => {
    endForControlRef.current = endForControl;
  }, [endForControl]);

  const startControl = useCallback(
    (sessionId: string, token: string, intervalMs: number | undefined) => {
      controlRef.current?.stop();
      const control = createPlaygroundControl({
        sessionId,
        token,
        intervalMs,
        setMuted: setControlMuted,
        onView: setControlView,
        onTerminated: (endNotice) => endForControl(endNotice),
      });
      controlRef.current = control;
      control.start();
    },
    [endForControl, setControlMuted],
  );

  const start = useCallback(
    async (mode: "connecting" | "reconnecting" = "connecting") => {
      if (mode === "connecting" && config.recording && !consentRef.current) {
        setConsentPending(true);
        return;
      }
      setConsentPending(false);
      setError(null);
      setNotice(null);
      setControlView(null);
      updateConnection(mode);
      if (mode === "connecting") {
        setCaptions([]);
        setSnapshot(null);
        setBrowserFirstAudio({});
        setBrowserInterrupts(0);
        snapshotRef.current = null;
        firstAudioRecorded.current.clear();
      }

      try {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        micRef.current = mic;

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const micNode = audioCtx.createAnalyser();
        micNode.fftSize = 512;
        audioCtx.createMediaStreamSource(mic).connect(micNode);
        micAnalyser.current = { node: micNode, buffer: new Float32Array(micNode.fftSize) };

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        mic.getTracks().forEach((track) => pc.addTrack(track, mic));
        pc.addEventListener("track", (event) => {
          const [remote] = event.streams;
          if (!remote) return;
          if (audioRef.current) audioRef.current.srcObject = remote;
          const remoteNode = audioCtx.createAnalyser();
          remoteNode.fftSize = 512;
          audioCtx.createMediaStreamSource(remote).connect(remoteNode);
          remoteAnalyser.current = { node: remoteNode, buffer: new Float32Array(remoteNode.fftSize) };
        });
        pc.addEventListener("connectionstatechange", () => {
          if (pcRef.current !== pc) return;
          if (pc.connectionState === "connected" && connectionRef.current !== "connected") {
            updateConnection("connected");
          }
          if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
            if (connectionRef.current === "degraded") {
              endForControl(VOICE_END_NOTICE_DISCONNECTED);
              return;
            }
            setError("Media connection lost. Reconnect to continue.");
            updateConnection("failed");
          }
        });

        // Must exist before the offer so it is negotiated in the SDP.
        const events = pc.createDataChannel("oai-events");
        events.addEventListener("message", (message) => {
          try {
            handleProviderEvent(JSON.parse(String(message.data)));
          } catch {
            // Non-JSON frames are ignored.
          }
        });

        await pc.setLocalDescription(await pc.createOffer());
        await waitForIceGathering(pc);

        const response = await fetch("/api/v1/voice/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assistantId: publicId,
            sdpOffer: pc.localDescription?.sdp ?? "",
            visitorId: visitorId(),
            // The server binds only durable sessions; no-store reads prior turns without writing.
            conversationId,
            history: history(),
            source: "playground",
            ...(consentRef.current ? { recordingConsent: true } : {}),
            capabilities: ["heartbeat"],
          }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          sessionId?: string;
          sdpAnswer?: string;
          ephemeral?: boolean;
          recording?: boolean;
          conversationId?: string | null;
          controlToken?: string;
          heartbeatIntervalMs?: number;
        };
        if (!response.ok || !body.sessionId || !body.sdpAnswer) {
          throw new Error(body.error ?? "Could not start a voice session.");
        }
        if (pcRef.current !== pc) {
          sessionIdRef.current = body.sessionId;
          await endServerSession("close_requested");
          return;
        }
        sessionIdRef.current = body.sessionId;
        setSessionMode({ ephemeral: Boolean(body.ephemeral), recording: Boolean(body.recording) });
        if (body.conversationId) onConversation(body.conversationId);
        if (body.controlToken) startControl(body.sessionId, body.controlToken, body.heartbeatIntervalMs);

        if (config.mockProvider) {
          // The mock provider returns a synthetic SDP answer; no media will flow.
          updateConnection("connected");
          appendCaption("system", "Mock provider: control plane only, no audio.");
          return;
        }
        await pc.setRemoteDescription({ type: "answer", sdp: body.sdpAnswer });
      } catch (caught) {
        const message =
          caught instanceof DOMException && caught.name === "NotAllowedError"
            ? "Microphone permission was denied."
            : caught instanceof Error
              ? caught.message
              : "Could not start a voice session.";
        setError(message);
        await endServerSession("error");
        teardown();
        updateConnection("failed");
      }
    },
    [
      appendCaption,
      config.mockProvider,
      config.recording,
      conversationId,
      endForControl,
      endServerSession,
      handleProviderEvent,
      history,
      onConversation,
      publicId,
      startControl,
      teardown,
      updateConnection,
      visitorId,
    ],
  );

  const reconnect = useCallback(async () => {
    await pollSnapshot();
    const endNotice = await endServerSession("connection_lost");
    teardown();
    reportCompletedTurns(snapshotRef.current);
    if (endNotice) {
      // ChatAI ended the call on purpose; reconnecting would only be refused.
      setError(null);
      updateConnection("ended");
      return;
    }
    await start("reconnecting");
  }, [endServerSession, pollSnapshot, reportCompletedTurns, start, teardown, updateConnection]);

  useEffect(() => {
    if (connection === "idle" || connection === "ended") {
      setPhase(deriveVoicePhase({ ...signals.current, connection, now: performance.now() }));
      return;
    }
    const timer = setInterval(() => {
      const now = performance.now();
      const state = signals.current;
      state.now = now;
      if (connection === "degraded") {
        setPhase(deriveVoicePhase(state));
        return;
      }
      if (rms(micAnalyser.current?.node ?? null, micAnalyser.current?.buffer ?? null) > MIC_RMS_THRESHOLD) {
        state.userVoiceAt = now;
      }
      if (
        rms(remoteAnalyser.current?.node ?? null, remoteAnalyser.current?.buffer ?? null) >
        REMOTE_RMS_THRESHOLD
      ) {
        markAssistantAudio(now);
      }
      const userActive = isUserActive(state);
      if (
        detectInterruption({
          userWasActive: userWasActive.current,
          userIsActive: userActive,
          assistantIsActive: isAssistantActive(state),
        })
      ) {
        state.interruptedAt = now;
        setBrowserInterrupts((count) => count + 1);
      }
      userWasActive.current = userActive;
      setPhase(deriveVoicePhase(state));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [connection, markAssistantAudio]);

  useEffect(() => {
    // Also while degraded: the owner sees sideband re-attach progress.
    if (connection !== "connected" && connection !== "degraded") return;
    const timer = setInterval(() => void pollSnapshot(), POLL_MS);
    return () => clearInterval(timer);
  }, [connection, pollSnapshot]);

  useEffect(() => {
    if (connection !== "ended" || !sessionIdRef.current) return;
    // Provider closed the session (e.g. max duration): finalize server-side too.
    void endServerSession("close_requested").then(() => {
      teardown();
      reportCompletedTurns(snapshotRef.current);
    });
  }, [connection, endServerSession, reportCompletedTurns, teardown]);

  useEffect(
    () => () => {
      void endServerSession("close_requested");
      teardown();
    },
    [endServerSession, teardown],
  );

  const active = isPlaygroundVoiceActive(connection);
  const ephemeral = sessionMode?.ephemeral ?? config.ephemeral;
  const controlDetail = active
    ? ownerControlDetail({
        health: controlView?.health ?? "healthy",
        heartbeatFailures: controlView?.heartbeatFailures ?? 0,
        misrouted: controlView?.misrouted ?? false,
        sideband: snapshot?.control ?? null,
      })
    : null;

  if (!config.available) {
    return (
      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        Voice (preview) is not configured on this instance. Set VOICE_OPENAI_API_KEY on the server.
      </div>
    );
  }

  return (
    <section className="border-b border-border bg-muted/20 px-3 py-3 sm:px-4" aria-label="Voice preview">
      <audio ref={audioRef} autoPlay hidden />
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", PHASE_TONE[phase])} aria-hidden />
        <p className="text-sm font-medium" aria-live="polite">
          Voice · {VOICE_PHASE_LABELS[phase]}
        </p>
        <span className="text-xs text-muted-foreground">
          {ephemeral
            ? "Ephemeral: storage is off, nothing is saved"
            : config.saveTranscripts
              ? "Voice transcript saved to this conversation"
              : "Voice transcript not saved (used only during this session)"}
          {!ephemeral && sessionMode?.recording && active ? " · Audio is being recorded" : null}
        </span>
        <div className="ml-auto flex gap-2">
          {connection === "failed" ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void reconnect()}>
              <RefreshCw />
              Reconnect
            </Button>
          ) : null}
          {active ? (
            <Button type="button" size="sm" variant="destructive" onClick={() => void stop()}>
              <PhoneOff />
              End voice
            </Button>
          ) : consentPending ? null : (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                consentRef.current = false;
                void start();
              }}
            >
              <Mic />
              Start voice
            </Button>
          )}
        </div>
      </div>
      {consentPending ? (
        <div
          role="group"
          aria-labelledby="voice-consent-title"
          aria-describedby="voice-consent-text"
          className="mt-3 rounded-lg border border-border bg-background p-3"
        >
          <p id="voice-consent-title" className="text-sm font-medium">
            This voice conversation is recorded
          </p>
          <p id="voice-consent-text" className="mt-1 text-xs text-muted-foreground">
            Audio of the call, your voice and the assistant&apos;s, is saved for owner review on this
            conversation. Visitors see the same notice in the widget. The microphone turns on only
            after you agree.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                consentRef.current = true;
                void start();
              }}
            >
              Agree and start
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setConsentPending(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        Owner test session.{" "}
        {config.publicEnabled
          ? "Public Voice is on: the public Voice endpoint also accepts widget and API sessions."
          : "Public Voice is off: only you can use Voice here; widget and API sessions are refused."}
      </p>
      {controlDetail ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400" role="status">
          {controlDetail}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      {notice && !error ? <p className="mt-2 text-xs text-muted-foreground">{notice}</p> : null}

      {captions.length || snapshot ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background p-2 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">Live transcript</p>
            {captions.map((caption) => (
              <p
                key={caption.id}
                className={cn(
                  "whitespace-pre-wrap py-0.5",
                  caption.role === "system" && "italic text-muted-foreground",
                  caption.role === "user" && "text-sky-700 dark:text-sky-300",
                )}
              >
                {caption.role === "system" ? caption.text : `${caption.role === "user" ? "You" : "Assistant"}: ${caption.text}`}
              </p>
            ))}
          </div>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border bg-background p-2 text-xs">
            <p className="mb-1 font-medium text-muted-foreground">
              Delegations
              {snapshot
                ? ` · ${snapshot.counters.delegations ?? 0} total · ${snapshot.counters.superseded ?? 0} superseded · ${snapshot.counters.bargeIns ?? 0} server barge-ins · ${browserInterrupts} browser barge-ins · ${snapshot.counters.lateResultsDiscarded ?? 0} late discarded · ${snapshot.counters.providerErrors ?? 0} provider errors`
                : null}
            </p>
            {snapshot && snapshot.turns.length === 0 && captions.some((caption) => caption.role === "assistant") ? (
              <p className="text-amber-700 dark:text-amber-400">
                No delegations yet: GPT-Live has answered on its own, so those replies did not use the
                knowledge base.
              </p>
            ) : null}
            {snapshot?.turns
              .slice()
              .reverse()
              .map((turn) => (
                <div key={turn.id} className="border-t border-border py-1.5 first:border-t-0">
                  <p>
                    <span className="font-medium">{turn.status}</span>
                    {turn.supersededBy ? ` (by ${turn.supersededBy})` : null}
                    {turn.interrupted ? " · interrupted" : null}
                    {turn.lateResultDiscarded ? " · late result discarded" : null}
                    {turn.outcome ? ` · ${turn.outcome}` : null}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {turn.origin === "server"
                      ? `${turn.id} · server-forced${turn.delegationId ? ` · adopted ${turn.delegationId}` : ""}`
                      : turn.delegationId}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Heard: </span>
                    {turn.userText || "(no transcript)"}
                  </p>
                  {turn.rewrittenQuery !== null ? (
                    <p>
                      <span className="text-muted-foreground">Search query: </span>
                      {turn.rewrittenQuery}
                      {turn.historySupplied !== null ? (
                        <span className="text-muted-foreground">
                          {" "}
                          (rewritten with {turn.historySupplied} prior turn
                          {turn.historySupplied === 1 ? "" : "s"})
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {turn.retrieval ? (
                    <div className="mt-0.5">
                      <p className="text-muted-foreground">
                        Retrieved {turn.retrieval.chunks.length} chunk(s) · context{" "}
                        {turn.retrieval.contextSufficient ? "sufficient" : "insufficient"} · {turn.retrieval.action}
                      </p>
                      {turn.retrieval.chunks.slice(0, 4).map((chunk, index) => (
                        <p key={index} className="truncate pl-2 text-muted-foreground" title={chunk.preview}>
                          {chunk.similarity.toFixed(3)} · {chunk.documentName} · {chunk.preview}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {turn.groundedAnswer ? (
                    <p>
                      <span className="text-muted-foreground">RAG answer: </span>
                      {turn.groundedAnswer}
                    </p>
                  ) : null}
                  {turn.answerText ? (
                    <p>
                      <span className="text-muted-foreground">Commentary: </span>
                      {turn.answerText}
                    </p>
                  ) : null}
                  {turn.commentary.eventId || turn.commentary.rejectReason ? (
                    <p className="text-muted-foreground">
                      Append{" "}
                      {turn.commentary.rejectReason
                        ? `rejected (${turn.commentary.rejectReason})`
                        : `${turn.commentary.eventId} · ${turn.commentary.acknowledged ? `acknowledged at ${turn.commentary.ackStartMs ?? "?"} ms` : "awaiting ack"}`}
                    </p>
                  ) : null}
                  {turn.spokenText ? (
                    <p>
                      <span className="text-muted-foreground">Spoken: </span>
                      {turn.spokenText}
                    </p>
                  ) : null}
                  {turn.error ? <p className="text-destructive">{turn.error}</p> : null}
                  <p className="font-mono text-[10px] text-muted-foreground">
                    utterance {ms(turn.metrics.utteranceReadyMs)} · RAG start {ms(turn.metrics.ragStartMs)} · RAG{" "}
                    {ms(turn.metrics.ragDurationMs)} · generate {ms(turn.metrics.generateDurationMs)} · commentary{" "}
                    {ms(turn.metrics.firstCommentaryMs)} · ack {ms(turn.metrics.commentaryAckMs)} · answer speech{" "}
                    {ms(turn.metrics.firstSpeechMs)} · browser first audio{" "}
                    {ms(turn.delegationId ? browserFirstAudio[turn.delegationId] : undefined)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
