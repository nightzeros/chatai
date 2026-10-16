import { z } from "zod";

import type { AssistantSettings } from "@chatai/database";
import { parseVoiceAppearance } from "@nightzeros/chatai-widget-core";

const hexColor = /^#[0-9A-Fa-f]{6}$/;

const suggestedQuestionSchema = z.string().trim().min(1).max(160);

/** Experiences the dashboard may save in this release. */
const voiceExperienceSchema = z.enum([
  "classic",
  "orb",
  "dock",
  "guided",
  "companion",
  "side-panel",
]);

export const voiceAppearanceSchema = z.object({
  experience: voiceExperienceSchema.optional(),
  accentColor: z
    .string()
    .trim()
    .regex(hexColor, "Use a 6-digit hex color for the voice accent.")
    .transform((value) => value.toUpperCase())
    .optional(),
  captionsDefault: z.boolean().optional(),
  motion: z.enum(["system", "reduced"]).optional(),
});

export const assistantSettingsSchema = z.object({
  primaryColor: z
    .string()
    .trim()
    .regex(hexColor, "Use a 6-digit hex color.")
    .transform((value) => value.toUpperCase())
    .optional(),
  position: z.enum(["bottom-left", "bottom-right"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  iconUrl: z
    .string()
    .trim()
    .url("Use a valid icon URL.")
    .refine((value) => new URL(value).protocol === "https:", "Icon URL must use HTTPS.")
    .nullable()
    .optional(),
  suggestedQuestions: z.array(suggestedQuestionSchema).max(5).optional(),
  showSources: z.boolean().optional(),
  voiceAppearance: voiceAppearanceSchema.optional(),
});

export type AssistantSettingsInput = z.infer<typeof assistantSettingsSchema>;

/**
 * Strip unsafe / unfinished voiceAppearance fields before returning public config.
 * Unknown experience strings are dropped (widget resolves to Classic); other valid
 * leaves such as captionsDefault are kept.
 */
export function normalizePublicAssistantSettings(settings: AssistantSettings): AssistantSettings {
  if (!settings.voiceAppearance) return settings;
  const parsed = parseVoiceAppearance(settings.voiceAppearance);
  if (Object.keys(parsed).length === 0) {
    const { voiceAppearance: _drop, ...rest } = settings;
    return rest;
  }
  return { ...settings, voiceAppearance: parsed };
}

export function settingsFromFormData(formData: FormData): AssistantSettingsInput {
  const suggestedQuestions = formData
    .getAll("suggestedQuestions")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const iconUrl = String(formData.get("iconUrl") ?? "").trim();

  const voiceExperience = formData.get("voiceExperience");
  const voiceAccent = String(formData.get("voiceAccentColor") ?? "").trim();
  const voiceCaptions = formData.get("voiceCaptionsDefault");
  const voiceMotion = formData.get("voiceMotion");
  const hasVoiceAppearance =
    (typeof voiceExperience === "string" && voiceExperience.length > 0) ||
    voiceAccent.length > 0 ||
    voiceCaptions !== null ||
    (typeof voiceMotion === "string" && voiceMotion.length > 0);

  return assistantSettingsSchema.parse({
    primaryColor: String(formData.get("primaryColor") ?? "").trim() || undefined,
    position: formData.get("position") || undefined,
    theme: formData.get("theme") || undefined,
    iconUrl: iconUrl || null,
    suggestedQuestions,
    showSources: formData.get("showSources") === "on",
    ...(hasVoiceAppearance
      ? {
          voiceAppearance: {
            experience: typeof voiceExperience === "string" && voiceExperience ? voiceExperience : undefined,
            accentColor: voiceAccent || undefined,
            captionsDefault:
              voiceCaptions === null
                ? undefined
                : voiceCaptions === "on" || voiceCaptions === "true"
                  ? true
                  : voiceCaptions === "off" || voiceCaptions === "false"
                    ? false
                    : undefined,
            motion: typeof voiceMotion === "string" && voiceMotion ? voiceMotion : undefined,
          },
        }
      : {}),
  });
}
