import { sql } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import {
  toEvalQuality,
  type EvalQualityAverageRow,
  type EvalQualityFailureRow,
  type EvalQualityLastRunRow,
} from "@/lib/eval-quality-metrics";

export type {
  EvalQuality,
  EvalQualityAverages,
  EvalQualityFailure,
  EvalQualityLastRun,
} from "@/lib/eval-quality-metrics";
export { toEvalQuality } from "@/lib/eval-quality-metrics";

export async function getOwnedEvalQuality(userId: string, assistantId: string) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const averages = await db().execute<EvalQualityAverageRow>(sql`
    SELECT s.metric AS metric, avg(s.score) AS average
    FROM eval_scores AS s
    INNER JOIN eval_runs AS r ON r.id = s.run_id
    WHERE r.assistant_id = ${assistantId}
      AND r.status = 'completed'
    GROUP BY s.metric
  `);

  const [lastRun] = await db().execute<EvalQualityLastRunRow>(sql`
    SELECT id, kind, status, created_at AS "createdAt", summary
    FROM eval_runs
    WHERE assistant_id = ${assistantId}
    ORDER BY created_at DESC
    LIMIT 1
  `);

  const failures = await db().execute<EvalQualityFailureRow>(sql`
    SELECT s.metric AS metric, s.score AS score, r.kind AS kind, s.created_at AS "createdAt"
    FROM eval_scores AS s
    INNER JOIN eval_runs AS r ON r.id = s.run_id
    WHERE r.assistant_id = ${assistantId}
      AND s.score < 0.5
    ORDER BY s.created_at DESC
    LIMIT 8
  `);

  return {
    assistant,
    quality: toEvalQuality({
      averages: [...averages],
      lastRun: lastRun ?? null,
      failures: [...failures],
    }),
  };
}
