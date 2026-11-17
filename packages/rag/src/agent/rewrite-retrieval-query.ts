import {
  emptyProviderUsage,
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
  type ProviderUsage,
} from "@chatai/ai";

import {
  boundHistory,
  CONVERSATION_HISTORY_WINDOW,
  type ChatHistoryMessage,
} from "../answer/turn-plan";
import { renderPurposeBlock, type ScopeProfile } from "../answer/scope";

const MAX_QUERY_CHARS = 200;

export type RewriteRetrievalQueryResult = {
  query: string;
  rawQuery: string;
  rewritten: boolean;
  usage: ProviderUsage;
};

/**
 * History-aware retrieval rewrite for the agent path.
 * Resolves pronouns / incomplete asks into one standalone search query.
 * Does not perform scope routing (no invite/out decisions).
 */
export async function rewriteRetrievalQuery(opts: {
  message: string;
  history: ChatHistoryMessage[];
  chat: ChatConfig;
  profile: ScopeProfile;
  generate?: GenerateChatFn;
  abortSignal?: AbortSignal;
}): Promise<RewriteRetrievalQueryResult> {
  const rawQuery = opts.message.trim().slice(0, 2000);
  if (!rawQuery) {
    return { query: "", rawQuery: "", rewritten: false, usage: emptyProviderUsage() };
  }
  if (opts.abortSignal?.aborted) {
    return { query: rawQuery, rawQuery, rewritten: false, usage: emptyProviderUsage() };
  }

  const generate = opts.generate ?? generateChat;
  const history = boundHistory(opts.history, CONVERSATION_HISTORY_WINDOW.messages);
  const subject =
    opts.profile.represents?.trim() ||
    opts.profile.redirectSubject?.trim() ||
    opts.profile.assistantName?.trim() ||
    "";

  try {
    const { text: raw, usage } = await runGenerateChat(generate, {
      config: opts.chat,
      system: [
        "Rewrite the latest user message as ONE standalone search query for knowledge retrieval.",
        'Return ONLY JSON: {"query":"..."}',
        "Resolve pronouns and incomplete references from chat history and the Purpose subject.",
        'With no competing referent, "their", "them", "his", "her", "it" refer to the Purpose subject.',
        'Incomplete asks like "what\'s their latest" or "the new project" should become a full query',
        "about that subject's recent work, projects, or products when history/Purpose support it.",
        `Max ${MAX_QUERY_CHARS} characters. Preserve names, negations, dates, and constraints.`,
        "Do not answer the question. Do not add assumed facts. Do not classify scope.",
      ].join(" "),
      prompt: [
        `Purpose:\n${renderPurposeBlock(opts.profile).slice(0, 1500)}`,
        subject ? `Primary subject: ${subject}` : "",
        `Recent chat (JSON):\n${JSON.stringify(
          history.map((item) => ({
            role: item.role,
            content: item.content.slice(0, 400),
          })),
        )}`,
        `Latest message:\n${rawQuery}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const parsed = parseRewriteQuery(raw);
    if (!parsed || !parsed.trim()) {
      return { query: rawQuery, rawQuery, rewritten: false, usage };
    }
    const query = parsed.trim().slice(0, MAX_QUERY_CHARS);
    return {
      query,
      rawQuery,
      rewritten: query.toLowerCase() !== rawQuery.toLowerCase(),
      usage,
    };
  } catch {
    return { query: rawQuery, rawQuery, rewritten: false, usage: emptyProviderUsage() };
  }
}

export function parseRewriteQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { query?: unknown };
    if (typeof parsed.query === "string" && parsed.query.trim()) {
      return parsed.query.trim();
    }
  } catch {
    // Fall through to bare-string acceptance for resilient tests.
  }
  if (trimmed.startsWith("{")) return null;
  return trimmed.slice(0, MAX_QUERY_CHARS);
}
