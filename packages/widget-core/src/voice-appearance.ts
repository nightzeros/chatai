/**
 * Presentation preferences for live Voice (not privacy/provider `voiceSettings`).
 * Unknown or unfinished experience strings resolve to Classic so embeds stay safe.
 */

export const VOICE_EXPERIENCES = [
  "classic",
  "orb",
  "dock",
  "guided",
  "companion",
  "side-panel",
] as const;
export type VoiceExperience = (typeof VOICE_EXPERIENCES)[number];

export type VoiceAppearance = {
  experience?: VoiceExperience;
  /** Optional #RRGGBB accent for the voice stage; otherwise the widget primary color. */
  accentColor?: string;
  /**
   * Default visibility of the Orb/Dock/Guided/Companion/Side-panel captions panel. Classic
   * ignores this and keeps its existing transcript / VoiceBar layout.
   */
  captionsDefault?: boolean;
  motion?: "system" | "reduced";
};

export type ResolvedVoiceAppearance = {
  experience: VoiceExperience;
  accentColor?: string;
  captionsDefault: boolean;
  motion: "system" | "reduced";
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

function isExperience(value: unknown): value is VoiceExperience {
  return typeof value === "string" && (VOICE_EXPERIENCES as readonly string[]).includes(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

/** Leaf merge: only defined override fields replace the base. */
export function mergeVoiceAppearance(
  base: VoiceAppearance | undefined,
  override: VoiceAppearance | undefined,
): VoiceAppearance {
  if (!base && !override) return {};
  return {
    ...(base?.experience !== undefined ? { experience: base.experience } : {}),
    ...(base?.accentColor !== undefined ? { accentColor: base.accentColor } : {}),
    ...(base?.captionsDefault !== undefined ? { captionsDefault: base.captionsDefault } : {}),
    ...(base?.motion !== undefined ? { motion: base.motion } : {}),
    ...(override?.experience !== undefined ? { experience: override.experience } : {}),
    ...(override?.accentColor !== undefined ? { accentColor: override.accentColor } : {}),
    ...(override?.captionsDefault !== undefined ? { captionsDefault: override.captionsDefault } : {}),
    ...(override?.motion !== undefined ? { motion: override.motion } : {}),
  };
}

/**
 * Coerce untrusted config/embed input into a safe appearance object.
 * Future enum values resolve to Classic until that surface ships.
 */
export function parseVoiceAppearance(input: unknown): VoiceAppearance {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const result: VoiceAppearance = {};
  if (isExperience(raw.experience)) result.experience = raw.experience;
  if (isHexColor(raw.accentColor)) result.accentColor = raw.accentColor.toUpperCase();
  if (typeof raw.captionsDefault === "boolean") result.captionsDefault = raw.captionsDefault;
  if (raw.motion === "system" || raw.motion === "reduced") result.motion = raw.motion;
  return result;
}

/** Defaults for missing fields. Classic + captions on + system motion. */
export function resolveVoiceAppearance(input: unknown): ResolvedVoiceAppearance {
  const parsed = parseVoiceAppearance(input);
  return {
    experience: parsed.experience ?? "classic",
    ...(parsed.accentColor !== undefined ? { accentColor: parsed.accentColor } : {}),
    captionsDefault: parsed.captionsDefault ?? true,
    motion: parsed.motion ?? "system",
  };
}
