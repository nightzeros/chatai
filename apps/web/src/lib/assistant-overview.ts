import { sql } from "@chatai/database";

import { getOwnedAssistant } from "@/lib/assistants";
import { listOwnedConversations } from "@/lib/conversations";
import { db } from "@/lib/db";

export type StatusCounts = {
  ready: number;
  processing: number;
  failed: number;
  total: number;
};

function toCount(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function toStatusCounts(row: {
  ready?: number | string | null;
  processing?: number | string | null;
  failed?: number | string | null;
  total?: number | string | null;
}): StatusCounts {
  const ready = toCount(row.ready);
  const processing = toCount(row.processing);
  const failed = toCount(row.failed);
  const total = toCount(row.total) || ready + processing + failed;
  return { ready, processing, failed, total };
}

export async function getAssistantOverview(userId: string, assistantId: string) {
  const assistant = await getOwnedAssistant(userId, assistantId);
  if (!assistant) return null;

  const [docRow] = await db().execute<{
    ready: number | string;
    processing: number | string;
    failed: number | string;
    total: number | string;
  }>(sql`
    SELECT
      cast(count(*) FILTER (WHERE status = 'ready') AS int) AS ready,
      cast(count(*) FILTER (WHERE status IN ('pending', 'processing') AND excluded = false) AS int) AS processing,
      cast(count(*) FILTER (WHERE status = 'failed') AS int) AS failed,
      cast(count(*) AS int) AS total
    FROM documents
    WHERE assistant_id = ${assistant.id}
  `);

  const [sourceRow] = await db().execute<{
    ready: number | string;
    processing: number | string;
    failed: number | string;
    total: number | string;
  }>(sql`
    SELECT
      cast(count(*) FILTER (WHERE status = 'ready') AS int) AS ready,
      cast(count(*) FILTER (WHERE status IN ('pending', 'syncing')) AS int) AS processing,
      cast(count(*) FILTER (WHERE status = 'failed') AS int) AS failed,
      cast(count(*) AS int) AS total
    FROM sources
    WHERE assistant_id = ${assistant.id}
  `);

  const [metricsRow] = await db().execute<{
    totalConversations: number | string;
    answered: number | string;
    unanswered: number | string;
  }>(sql`
    SELECT
      (SELECT cast(count(*) AS int) FROM conversations WHERE assistant_id = ${assistant.id}) AS "totalConversations",
      cast(count(*) FILTER (WHERE m.role = 'assistant' AND m.outcome = 'answered_with_context') AS int) AS answered,
      cast(count(*) FILTER (WHERE m.role = 'assistant' AND m.outcome IN ('fallback_no_context', 'low_confidence')) AS int) AS unanswered
    FROM messages AS m
    INNER JOIN conversations AS c ON c.id = m.conversation_id
    WHERE c.assistant_id = ${assistant.id}
  `);

  const recentConversations = await listOwnedConversations(userId, assistant.id, 5);

  const documentCounts = toStatusCounts(docRow ?? {});
  const sourceCounts = toStatusCounts(sourceRow ?? {});
  const knowledgeTotal = documentCounts.total + sourceCounts.total;

  return {
    assistant,
    requireWidgetSigning: Boolean(assistant.securitySettings?.requireWidgetSigning),
    hasSigningSecret: Boolean(assistant.securitySettings?.widgetSigningSecret),
    documentCounts,
    sourceCounts,
    knowledgeTotal,
    conversationTotal: toCount(metricsRow?.totalConversations),
    answered: toCount(metricsRow?.answered),
    unanswered: toCount(metricsRow?.unanswered),
    recentConversations,
  };
}

export async function listAssistantDashboardStats(userId: string) {
  const rows = await db().execute<{
    assistantId: string;
    knowledgeReady: number | string;
    knowledgeProcessing: number | string;
    knowledgeFailed: number | string;
    conversationCount: number | string;
  }>(sql`
    SELECT
      a.id AS "assistantId",
      (
        SELECT cast(count(*) AS int) FROM documents d
        WHERE d.assistant_id = a.id AND d.status = 'ready'
      ) + (
        SELECT cast(count(*) AS int) FROM sources s
        WHERE s.assistant_id = a.id AND s.status = 'ready'
      ) AS "knowledgeReady",
      (
        SELECT cast(count(*) AS int) FROM documents d
        WHERE d.assistant_id = a.id AND d.status IN ('pending', 'processing') AND d.excluded = false
      ) + (
        SELECT cast(count(*) AS int) FROM sources s
        WHERE s.assistant_id = a.id AND s.status IN ('pending', 'syncing')
      ) AS "knowledgeProcessing",
      (
        SELECT cast(count(*) AS int) FROM documents d
        WHERE d.assistant_id = a.id AND d.status = 'failed'
      ) + (
        SELECT cast(count(*) AS int) FROM sources s
        WHERE s.assistant_id = a.id AND s.status = 'failed'
      ) AS "knowledgeFailed",
      (
        SELECT cast(count(*) AS int) FROM conversations c
        WHERE c.assistant_id = a.id
      ) AS "conversationCount"
    FROM assistants a
    WHERE a.user_id = ${userId}
  `);

  const map = new Map<
    string,
    {
      knowledgeReady: number;
      knowledgeProcessing: number;
      knowledgeFailed: number;
      conversationCount: number;
    }
  >();

  for (const row of rows) {
    map.set(row.assistantId, {
      knowledgeReady: toCount(row.knowledgeReady),
      knowledgeProcessing: toCount(row.knowledgeProcessing),
      knowledgeFailed: toCount(row.knowledgeFailed),
      conversationCount: toCount(row.conversationCount),
    });
  }

  return map;
}
