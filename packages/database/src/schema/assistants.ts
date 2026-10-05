import { relations } from "drizzle-orm";
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import type { PrivacySettings } from "./privacy-settings";
import type { RagSettings } from "./rag-settings";
import type { SecuritySettings } from "./security-settings";
import type { VoiceSettings } from "./voice-settings";

export const hallucinationModeEnum = pgEnum("hallucination_mode", [
  "strict",
  "balanced",
  "flexible",
]);

export type AssistantSettings = {
  primaryColor?: string;
  position?: "bottom-left" | "bottom-right";
  theme?: "light" | "dark" | "system";
  iconUrl?: string | null;
  suggestedQuestions?: string[];
  showSources?: boolean;
};

/** Per-assistant chat/embedding overrides. Empty object uses instance env defaults. No API keys. */
export type ModelSettings = {
  chatProvider?: string;
  chatModel?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
};

export const assistants = pgTable("assistants", {
  id: text("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions"),
  welcomeMessage: text("welcome_message").notNull().default("Hi! How can I help you today?"),
  hallucinationMode: hallucinationModeEnum("hallucination_mode").notNull().default("balanced"),
  settings: jsonb("settings").$type<AssistantSettings>().notNull().default({}),
  ragSettings: jsonb("rag_settings").$type<RagSettings>().notNull().default({}),
  modelSettings: jsonb("model_settings").$type<ModelSettings>().notNull().default({}),
  securitySettings: jsonb("security_settings").$type<SecuritySettings>().notNull().default({}),
  privacySettings: jsonb("privacy_settings").$type<PrivacySettings>().notNull().default({}),
  voiceSettings: jsonb("voice_settings").$type<VoiceSettings>().notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantsRelations = relations(assistants, ({ one }) => ({
  user: one(user, {
    fields: [assistants.userId],
    references: [user.id],
  }),
}));
