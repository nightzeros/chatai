import type { RealtimeVoiceProvider, VoiceControlChannel, VoiceControlEvent } from "@chatai/voice";

import { handleControlDisconnected, handleControlReattached } from "./control-plane";
import { handleVoiceControlEvent } from "./delegation-orchestrator";
import { recordVoiceMediaEvidence, recordVoiceUsageSnapshot } from "./enforcement";
import { terminateVoiceSession } from "./lifecycle";
import { markVoiceSessionConnected, writeLifecycleVoiceEvent } from "./persist";
import { applyControlEvent, type VoiceRuntimeSession } from "./session-runtime";
import { endProviderSession } from "./termination";

/**
 * Sideband supervisor: wire provider control events into the runtime session.
 *
 * - transcripts / delegation.created / acks → delegation orchestrator (prepareAnswer)
 * - session.closed (remote_hangup / connection_lost / expired / content) → finalize + wipe
 * - control.disconnected → control plane (bounded re-attach, never an immediate end)
 */
export function superviseSideband(
  session: VoiceRuntimeSession,
  channel: VoiceControlChannel,
): void {
  session.channel = channel;

  const onEvent = (event: VoiceControlEvent) => {
    applyControlEvent(session, event);
    handleVoiceControlEvent(session, event);

    switch (event.type) {
      case "usage.updated":
        recordVoiceUsageSnapshot(session, event.seconds);
        break;

      case "transcript.input.delta":
      case "transcript.output.delta":
      case "assistant.output.started":
      case "delegation.created":
        recordVoiceMediaEvidence(session);
        break;

      case "session.started":
        void markVoiceSessionConnected(session).catch(() => undefined);
        void writeLifecycleVoiceEvent(session, "session.started", {
          providerSessionId: session.providerSessionId,
        }).catch(() => undefined);
        break;

      case "session.closed":
        // Provider closed on its own (client hung up, WebRTC lost, expiry, policy).
        // If a client end is in flight, terminateVoiceSession dedupes.
        if (session.status !== "ending") {
          void terminateVoiceSession(session, {
            reason: event.reason,
            requestProviderClose: false,
          });
        }
        break;

      case "control.disconnected":
        handleControlDisconnected(session, event);
        break;

      case "control.reattached":
        handleControlReattached(session, event.gapMs);
        break;

      case "error":
        session.errorCode = event.code;
        break;

      default:
        break;
    }
  };

  session.unsubscribe = channel.subscribe(onEvent);
}

/**
 * Mint failed after the provider session was created: end it for real (hangup,
 * with the sideband observing when attached) so it never runs unsupervised.
 */
export async function cleanupFailedMint(input: {
  provider: RealtimeVoiceProvider;
  channel: VoiceControlChannel | null;
  providerSessionId: string;
}): Promise<void> {
  try {
    await endProviderSession({
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      channel: input.channel,
      reattach: false,
    });
  } catch {
    // ignore — mint failure path already surfaces the root error
  }
}
