import { z } from "zod";

const hexColor = /^#[0-9A-Fa-f]{6}$/;

const suggestedQuestionSchema = z.string().trim().min(1).max(160);

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
});

export type AssistantSettingsInput = z.infer<typeof assistantSettingsSchema>;

export function settingsFromFormData(formData: FormData): AssistantSettingsInput {
  const suggestedQuestions = formData
    .getAll("suggestedQuestions")
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const iconUrl = String(formData.get("iconUrl") ?? "").trim();

  return assistantSettingsSchema.parse({
    primaryColor: String(formData.get("primaryColor") ?? "").trim() || undefined,
    position: formData.get("position") || undefined,
    theme: formData.get("theme") || undefined,
    iconUrl: iconUrl || null,
    suggestedQuestions,
    showSources: formData.get("showSources") === "on",
  });
}
