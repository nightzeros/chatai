import { relations } from "drizzle-orm";
import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";

export const assistantProviderSecretKindEnum = pgEnum("assistant_provider_secret_kind", [
  "chat",
  "embedding",
]);

export type AssistantProviderSecretKind =
  (typeof assistantProviderSecretKindEnum.enumValues)[number];

export const assistantProviderSecrets = pgTable(
  "assistant_provider_secrets",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    kind: assistantProviderSecretKindEnum("kind").notNull(),
    /** Registry provider id, e.g. openai, anthropic. */
    provider: text("provider").notNull(),
    /** Base64(iv + authTag + ciphertext) from AES-256-GCM. Never expose to clients. */
    ciphertext: text("ciphertext").notNull(),
    /** Last 4 characters for UI display. */
    keyPrefix: text("key_prefix"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("assistant_provider_secrets_assistant_id_kind_uidx").on(
      table.assistantId,
      table.kind,
    ),
  ],
);

export const assistantProviderSecretsRelations = relations(
  assistantProviderSecrets,
  ({ one }) => ({
    assistant: one(assistants, {
      fields: [assistantProviderSecrets.assistantId],
      references: [assistants.id],
    }),
  }),
);
