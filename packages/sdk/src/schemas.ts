import { z } from "zod";

export const hallucinationModeSchema = z.enum(["strict", "balanced", "flexible"]);

export const assistantCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  welcomeMessage: z.string().trim().max(500).optional(),
  instructions: z.string().trim().max(8000).nullable().optional(),
  hallucinationMode: hallucinationModeSchema.optional(),
});

export const assistantPatchFieldsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  welcomeMessage: z.string().trim().min(1).max(500).optional(),
  instructions: z.string().trim().max(8000).nullable().optional(),
  hallucinationMode: hallucinationModeSchema.optional(),
});

export const assistantPatchSchema = assistantPatchFieldsSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: "No fields to update." },
);

export const chatRequestSchema = z.object({
  assistantId: z.string().min(1, "assistantId is required"),
  conversationId: z.string().min(1).optional(),
  message: z.string().trim().min(1, "message is required").max(4000),
  visitorId: z.string().min(1).max(80).optional(),
  source: z.enum(["playground", "widget", "api"]).optional(),
});

export const errorSchema = z.object({
  error: z.string(),
});

export const assistantSchema = z.object({
  id: z.string(),
  publicId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  welcomeMessage: z.string(),
  instructions: z.string().nullable(),
  hallucinationMode: hallucinationModeSchema,
  settings: z.record(z.unknown()),
  ragSettings: z.record(z.unknown()),
  modelSettings: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const documentSchema = z.object({
  id: z.string(),
  assistantId: z.string(),
  type: z.enum(["file", "text", "faq", "url"]),
  name: z.string(),
  mimeType: z.string().nullable(),
  status: z.enum(["pending", "processing", "ready", "failed"]),
  error: z.string().nullable(),
  chunkCount: z.number(),
  excluded: z.boolean(),
  url: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const okSchema = z.object({ ok: z.literal(true) });

export type AssistantCreateInput = z.infer<typeof assistantCreateSchema>;
export type AssistantPatchInput = z.infer<typeof assistantPatchSchema>;
export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
export type Assistant = z.infer<typeof assistantSchema>;
export type Document = z.infer<typeof documentSchema>;
