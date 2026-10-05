import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";

const instanceKey = "__chatai_voice_runtime_instance_id__";

/** Hashed so the stored id carries no raw hostname. */
function localHostKey(): string {
  return createHash("sha256").update(hostname()).digest("hex").slice(0, 12);
}

export function formatVoiceRuntimeInstanceId(input: { hostKey: string; pid: number; bootId: string }): string {
  return `rt_${input.hostKey}_${input.pid}_${input.bootId}`;
}

/**
 * Id of this server process (new on every boot): `rt_<hostKey>_<pid>_<bootId>`.
 * Stored on each minted voice_sessions row so heartbeats can tell "owned elsewhere"
 * from "owner gone".
 */
export function voiceRuntimeInstanceId(): string {
  const g = globalThis as typeof globalThis & { [instanceKey]?: string };
  g[instanceKey] ??= formatVoiceRuntimeInstanceId({
    hostKey: localHostKey(),
    pid: process.pid,
    bootId: randomUUID(),
  });
  return g[instanceKey];
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type VoiceRuntimeOwner = "self" | "dead" | "unknown";

/**
 * Whether the process that owns a session row can still be alive.
 * `dead` is only claimed for an earlier process on this same host (a restart):
 * its pid is gone, or this process now has that pid. Other hosts and legacy ids
 * are `unknown` (possibly alive).
 */
export function voiceRuntimeOwner(
  instanceId: string,
  deps: { self?: string; hostKey?: string; pid?: number; isPidAlive?: (pid: number) => boolean } = {},
): VoiceRuntimeOwner {
  const self = deps.self ?? voiceRuntimeInstanceId();
  if (instanceId === self) return "self";
  const match = /^rt_([0-9a-f]{12})_(\d+)_[0-9a-f-]+$/.exec(instanceId);
  if (!match || match[1] !== (deps.hostKey ?? localHostKey())) return "unknown";
  const pid = Number(match[2]);
  if (pid === (deps.pid ?? process.pid)) return "dead";
  return (deps.isPidAlive ?? isPidAlive)(pid) ? "unknown" : "dead";
}
