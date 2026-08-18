import { relations } from "drizzle-orm";
import {
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { assistants } from "./assistants";
import { messages } from "./conversations";

export const evalRunKindEnum = pgEnum("eval_run_kind", ["online", "offline"]);

export const evalRunStatusEnum = pgEnum("eval_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export type EvalRunKind = (typeof evalRunKindEnum.enumValues)[number];
export type EvalRunStatus = (typeof evalRunStatusEnum.enumValues)[number];

export type EvalRunSummary = {
  caseCount?: number;
  scoredCount?: number;
  averages?: Record<string, number>;
  error?: string;
};

export const evalSets = pgTable(
  "eval_sets",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("eval_sets_assistant_id_updated_at_idx").on(table.assistantId, table.updatedAt)],
);

export const evalCases = pgTable(
  "eval_cases",
  {
    id: text("id").primaryKey(),
    evalSetId: text("eval_set_id")
      .notNull()
      .references(() => evalSets.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    expectedAnswer: text("expected_answer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("eval_cases_eval_set_id_idx").on(table.evalSetId)],
);

export const evalRuns = pgTable(
  "eval_runs",
  {
    id: text("id").primaryKey(),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    evalSetId: text("eval_set_id").references(() => evalSets.id, { onDelete: "set null" }),
    kind: evalRunKindEnum("kind").notNull(),
    status: evalRunStatusEnum("status").notNull().default("pending"),
    summary: jsonb("summary").$type<EvalRunSummary>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("eval_runs_assistant_id_created_at_idx").on(table.assistantId, table.createdAt),
    index("eval_runs_eval_set_id_idx").on(table.evalSetId),
  ],
);

export const evalScores = pgTable(
  "eval_scores",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    messageId: text("message_id").references(() => messages.id, { onDelete: "set null" }),
    caseId: text("case_id").references(() => evalCases.id, { onDelete: "set null" }),
    metric: text("metric").notNull(),
    score: doublePrecision("score").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("eval_scores_run_id_idx").on(table.runId),
    index("eval_scores_message_id_idx").on(table.messageId),
    index("eval_scores_case_id_idx").on(table.caseId),
  ],
);

export const evalSetsRelations = relations(evalSets, ({ one, many }) => ({
  assistant: one(assistants, {
    fields: [evalSets.assistantId],
    references: [assistants.id],
  }),
  cases: many(evalCases),
  runs: many(evalRuns),
}));

export const evalCasesRelations = relations(evalCases, ({ one, many }) => ({
  evalSet: one(evalSets, {
    fields: [evalCases.evalSetId],
    references: [evalSets.id],
  }),
  scores: many(evalScores),
}));

export const evalRunsRelations = relations(evalRuns, ({ one, many }) => ({
  assistant: one(assistants, {
    fields: [evalRuns.assistantId],
    references: [assistants.id],
  }),
  evalSet: one(evalSets, {
    fields: [evalRuns.evalSetId],
    references: [evalSets.id],
  }),
  scores: many(evalScores),
}));

export const evalScoresRelations = relations(evalScores, ({ one }) => ({
  run: one(evalRuns, {
    fields: [evalScores.runId],
    references: [evalRuns.id],
  }),
  message: one(messages, {
    fields: [evalScores.messageId],
    references: [messages.id],
  }),
  case: one(evalCases, {
    fields: [evalScores.caseId],
    references: [evalCases.id],
  }),
}));
