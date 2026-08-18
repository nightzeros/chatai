import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { documents } from "./documents";
import { ingestJobs } from "./jobs";

export const sourceTypeEnum = pgEnum("source_type", ["website"]);

export const sourceStatusEnum = pgEnum("source_status", [
  "pending",
  "syncing",
  "ready",
  "failed",
]);

export type SourceType = (typeof sourceTypeEnum.enumValues)[number];
export type SourceStatus = (typeof sourceStatusEnum.enumValues)[number];

export type WebsiteSourceConfig = {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
};

export type SourceConfig = WebsiteSourceConfig;

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    type: sourceTypeEnum("type").notNull().default("website"),
    name: text("name").notNull(),
    /** Normalized website origin key for deduplication within an assistant. */
    originKey: text("origin_key").notNull(),
    config: jsonb("config").$type<SourceConfig>().notNull(),
    status: sourceStatusEnum("status").notNull().default("pending"),
    error: text("error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Reserved for scheduled refresh (not used in v0.4). */
    scheduleCron: text("schedule_cron"),
    /** Reserved for scheduled refresh (not used in v0.4). */
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sources_assistant_id_updated_at_idx").on(table.assistantId, table.updatedAt),
    uniqueIndex("sources_assistant_id_origin_key_uidx").on(table.assistantId, table.originKey),
  ],
);

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  assistant: one(assistants, {
    fields: [sources.assistantId],
    references: [assistants.id],
  }),
  documents: many(documents),
  ingestJobs: many(ingestJobs),
}));
