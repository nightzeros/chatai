import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { evalCases, evalRuns } from "./evals";
import { messages } from "./conversations";
import { ingestJobStatusEnum } from "./jobs";

export const evalJobs = pgTable(
  "eval_jobs",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").references(() => messages.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => evalRuns.id, { onDelete: "cascade" }),
    caseId: text("case_id").references(() => evalCases.id, { onDelete: "cascade" }),
    status: ingestJobStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("eval_jobs_status_locked_at_idx").on(table.status, table.lockedAt),
    index("eval_jobs_message_id_idx").on(table.messageId),
    index("eval_jobs_run_id_idx").on(table.runId),
    check(
      "eval_jobs_target_keys",
      sql`(
        (${table.messageId} IS NOT NULL AND ${table.runId} IS NULL AND ${table.caseId} IS NULL)
        OR (${table.runId} IS NOT NULL AND ${table.caseId} IS NOT NULL AND ${table.messageId} IS NULL)
      )`,
    ),
  ],
);

export const evalJobsRelations = relations(evalJobs, ({ one }) => ({
  message: one(messages, {
    fields: [evalJobs.messageId],
    references: [messages.id],
  }),
  run: one(evalRuns, {
    fields: [evalJobs.runId],
    references: [evalRuns.id],
  }),
  evalCase: one(evalCases, {
    fields: [evalJobs.caseId],
    references: [evalCases.id],
  }),
}));
