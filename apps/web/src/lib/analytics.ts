import { sql } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { db } from "@/lib/db";
import {
  toAnalyticsMetrics,
  toTopUnansweredQuestions,
} from "@/lib/analytics-metrics";

type UnansweredQuestionRow = {
  question: string;
  count: number | string;
};

type AnalyticsMetricsRow = {
  totalConversations: number | string;
  totalQuestions: number | string;
  answered: number | string;
  unanswered: number | string;
  positiveFeedback: number | string;
  negativeFeedback: number | string;
  averageConfidence: number | string | null;
  averageResponseMs: number | string | null;
};

export type { AnalyticsMetrics, TopUnansweredQuestion } from "@/lib/analytics-metrics";

export async function getOwnedAssistantAnalytics(userId: string, assistantId: string) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const analytics = await getAssistantAnalytics(assistant.id);
  return { assistant, ...analytics };
}

async function getAssistantAnalytics(assistantId: string) {
  const [metricsRow] = await db().execute<AnalyticsMetricsRow>(sql`
    SELECT
      (SELECT cast(count(*) AS int) FROM conversations WHERE assistant_id = ${assistantId}) AS "totalConversations",
      cast(count(*) FILTER (WHERE m.role = 'user') AS int) AS "totalQuestions",
      cast(count(*) FILTER (WHERE m.role = 'assistant' AND m.outcome = 'answered_with_context') AS int) AS "answered",
      cast(count(*) FILTER (WHERE m.role = 'assistant' AND m.outcome IN ('fallback_no_context', 'low_confidence')) AS int) AS "unanswered",
      cast(count(*) FILTER (WHERE m.role = 'assistant' AND m.feedback = 'positive') AS int) AS "positiveFeedback",
      cast(count(*) FILTER (WHERE m.role = 'assistant' AND m.feedback = 'negative') AS int) AS "negativeFeedback",
      avg(m.confidence) FILTER (
        WHERE m.role = 'assistant'
          AND m.outcome IN ('answered_with_context', 'fallback_no_context', 'low_confidence')
          AND m.confidence IS NOT NULL
      ) AS "averageConfidence",
      avg(m.latency_ms) FILTER (WHERE m.role = 'assistant' AND m.latency_ms IS NOT NULL) AS "averageResponseMs"
    FROM messages AS m
    INNER JOIN conversations AS c ON c.id = m.conversation_id
    WHERE c.assistant_id = ${assistantId}
  `);

  const rows = await db().execute<UnansweredQuestionRow>(sql`
    WITH unanswered AS (
      SELECT (
        SELECT u.content
        FROM messages AS u
        WHERE u.conversation_id = m.conversation_id
          AND u.role = 'user'
          AND u.created_at <= m.created_at
        ORDER BY u.created_at DESC
        LIMIT 1
      ) AS question
      FROM messages AS m
      INNER JOIN conversations AS c ON c.id = m.conversation_id
      WHERE c.assistant_id = ${assistantId}
        AND m.role = 'assistant'
        AND m.outcome IN ('fallback_no_context', 'low_confidence')
    )
    SELECT min(question) AS question, cast(count(*) AS int) AS count
    FROM unanswered
    WHERE question IS NOT NULL AND trim(question) <> ''
    GROUP BY regexp_replace(
      regexp_replace(lower(trim(question)), '\\s+', ' ', 'g'),
      '[?!.,;:]+$',
      ''
    )
    ORDER BY count DESC, question ASC
    LIMIT 10
  `);

  return {
    metrics: toAnalyticsMetrics(
      metricsRow ?? {
        totalConversations: 0,
        totalQuestions: 0,
        answered: 0,
        unanswered: 0,
        positiveFeedback: 0,
        negativeFeedback: 0,
        averageConfidence: null,
        averageResponseMs: null,
      },
    ),
    topUnanswered: toTopUnansweredQuestions(rows),
  };
}
