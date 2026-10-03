/**
 * Configurable defaults for ChatAI Voice V1.
 * Call sites should read these (or env overrides later) — do not scatter literals.
 */

/** Cloud V1 default realtime model id (provider-specific value lives in adapter config). */
export const DEFAULT_VOICE_MODEL = "gpt-live-1";

/** Initial prototype / default speaking voice id — configuration, not architecture. */
export const DEFAULT_VOICE_ID = "marin";

/** V1 production architecture uses client delegation only. */
export const DEFAULT_DELEGATION_MODE = "client" as const;

export type VoiceDelegationMode = typeof DEFAULT_DELEGATION_MODE;
