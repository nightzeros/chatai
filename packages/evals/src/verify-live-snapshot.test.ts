import { createDb, evalCases, evalScores, eq } from "@chatai/database";
import { describe, expect, it } from "vitest";

import { enqueueOfflineEvalRun } from "./run-offline-eval";
import { readPersistedSnapshot } from "./persist-details";

const LIVE = process.env.EVAL_VERIFY_LIVE === "1";
const ASSISTANT_ID = "TvCKdS_shlBRmcL3M7fp6";
const EVAL_SET_ID = "FLO7L2E06lsQrZvJ3wW14";

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!LIVE)("live eval snapshot persistence", () => {
  it(
    "worker persists details.snapshot.retrieval on new offline runs",
    async () => {
      const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
      if (!url) throw new Error("DATABASE_URL is required for live verification.");

      const db = createDb(url, { max: 1 });
      const cases = await db.select().from(evalCases).where(eq(evalCases.evalSetId, EVAL_SET_ID));
      expect(cases.length).toBeGreaterThan(0);

      const runId = await enqueueOfflineEvalRun({
        db,
        assistantId: ASSISTANT_ID,
        evalSetId: EVAL_SET_ID,
        caseIds: cases.map((item) => item.id),
      });

      let rows: Array<{ details: Record<string, unknown> | null }> = [];
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(2000);
        rows = await db.select({ details: evalScores.details }).from(evalScores).where(eq(evalScores.runId, runId));
        if (rows.length >= cases.length * 4) break;
      }

      expect(rows.length, "expected score rows for completed offline case").toBeGreaterThan(0);

      for (const row of rows) {
        const snapshot = readPersistedSnapshot(row.details ?? undefined);
        expect(snapshot, "snapshot not persisted").toBeDefined();
      }

      const retrievalLengths = rows.map((row) => readPersistedSnapshot(row.details ?? undefined)?.retrieval.length ?? 0);
      expect(Math.max(...retrievalLengths), "snapshot retrieval must be non-empty").toBeGreaterThan(0);
    },
    180_000,
  );
});
