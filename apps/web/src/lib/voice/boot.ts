import { logVoiceEvent, logVoiceWarning } from "./observability";
import { detectServerlessPlatform } from "./runtime-mode";
import { installVoiceShutdownHandlers, voiceShutdownGraceMs } from "./shutdown";

/**
 * Voice runtime mode and graceful drain on SIGTERM/SIGINT. The drain needs Next's
 * own signal handling off (`NEXT_MANUAL_SIG_HANDLE=1`); otherwise Next exits within
 * ~50 ms and live calls fall back to crash recovery.
 */
export function startVoiceRuntime(): void {
  const serverless = detectServerlessPlatform();
  if (serverless) {
    logVoiceWarning("runtime.boot", { mode: "serverless_unsupported", platform: serverless, voice: "disabled" });
    return;
  }
  const manualSignals = Boolean(process.env.NEXT_MANUAL_SIG_HANDLE);
  const installed = installVoiceShutdownHandlers();
  logVoiceEvent("runtime.boot", {
    mode: "long_lived_node",
    pid: process.pid,
    signalHandlers: installed ? "installed" : "already_installed",
    manualSignals,
    shutdownGraceMs: voiceShutdownGraceMs(),
  });
  if (!manualSignals && process.env.NODE_ENV === "production") {
    logVoiceWarning("runtime.drain_unavailable", { reason: "NEXT_MANUAL_SIG_HANDLE_unset" });
  }
}
