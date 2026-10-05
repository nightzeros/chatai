import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { ingestJobStatusEnum } from "./jobs";

/**
 * Assistant Profile: an owner-authored Purpose (the scope authority) and a short
 * list of Key facts (always-available data). Generated content never becomes
 * authority: generated facts are suggestions until the owner accepts them, and a
 * Purpose suggested from Knowledge is never served until the owner confirms it.
 */

export type AssistantPurposeMode = "focused" | "general";

export type AssistantPurpose = {
  /** What the assistant helps visitors with (the allowed domain). */
  summary: string;
  /** The organization, person or subject it represents. */
  represents: string | null;
  /** Natural redirect for unrelated requests (also used as the vague-help invitation). */
  redirect: string | null;
  /** "general" only by explicit owner choice. */
  mode: AssistantPurposeMode;
  /** "suggested" = generated from the owner's Instructions; "owner" = saved by the owner. */
  origin: "suggested" | "owner";
  /** Hash of the Instructions the purpose was derived from or confirmed against. */
  instructionsHash: string | null;
  confirmedAt: string | null;
};

/** A pending Purpose suggestion; never served. */
export type AssistantPurposeSuggestion = Omit<AssistantPurpose, "origin" | "confirmedAt"> & {
  basis: "instructions" | "knowledge";
  createdAt: string;
};

export type KeyFactSource = {
  documentId: string;
  contentHash: string | null;
  /** Word-for-word excerpt from the document that supports the fact. */
  quote: string;
};

export type KeyFact = {
  id: string;
  text: string;
  topic: string;
  origin: "generated" | "owner";
  sources: KeyFactSource[];
  createdAt: string;
};

export type KeyFactSuggestion = KeyFact & {
  action: "add" | "replace";
  replacesFactId: string | null;
};

export type ProfileConflict = { topic: string; documentIds: string[] };

export const PROFILE_REFRESH_STATUSES = ["idle", "pending", "running", "failed"] as const;
export type ProfileRefreshStatus = (typeof PROFILE_REFRESH_STATUSES)[number];
export const profileRefreshStatusEnum = pgEnum("profile_refresh_status", [...PROFILE_REFRESH_STATUSES]);

export const PROFILE_JOB_KINDS = ["facts", "purpose"] as const;
export type ProfileJobKind = (typeof PROFILE_JOB_KINDS)[number];
export const profileJobKindEnum = pgEnum("profile_job_kind", [...PROFILE_JOB_KINDS]);

export const assistantProfiles = pgTable("assistant_profiles", {
  assistantId: text("assistant_id")
    .primaryKey()
    .references(() => assistants.id, { onDelete: "cascade" }),
  /** Incremented on every published change; used as an optimistic write guard. */
  version: integer("version").notNull().default(1),
  purpose: jsonb("purpose").$type<AssistantPurpose | null>(),
  purposeSuggestion: jsonb("purpose_suggestion").$type<AssistantPurposeSuggestion | null>(),
  facts: jsonb("facts").$type<KeyFact[]>().notNull().default(sql`'[]'::jsonb`),
  suggestions: jsonb("suggestions").$type<KeyFactSuggestion[]>().notNull().default(sql`'[]'::jsonb`),
  /** Fingerprints of generated facts the owner removed or rejected; never suggested again. */
  dismissed: jsonb("dismissed").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  conflicts: jsonb("conflicts").$type<ProfileConflict[]>().notNull().default(sql`'[]'::jsonb`),
  /** Set when the owner first publishes facts; Knowledge changes refresh suggestions afterwards. */
  factsPublishedAt: timestamp("facts_published_at", { withTimezone: true }),
  refreshStatus: profileRefreshStatusEnum("refresh_status").notNull().default("idle"),
  /** Sanitized; never contains document text. */
  lastError: text("last_error"),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
  knowledgeFingerprint: text("knowledge_fingerprint"),
  refreshDay: date("refresh_day"),
  refreshesToday: integer("refreshes_today").notNull().default(0),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantProfileJobs = pgTable(
  "assistant_profile_jobs",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    kind: profileJobKindEnum("kind").notNull(),
    reason: text("reason").notNull(),
    status: ingestJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Debounce: bulk Knowledge changes collapse into one job that runs after this time. */
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("assistant_profile_jobs_status_idx").on(table.status, table.runAfter),
    uniqueIndex("assistant_profile_jobs_one_pending")
      .on(table.assistantId, table.kind)
      .where(sql`${table.status} = 'pending'`),
  ],
);
