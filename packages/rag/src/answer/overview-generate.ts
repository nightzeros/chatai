import {
  generateChat,
  runGenerateChat,
  type ChatConfig,
  type GenerateChatFn,
} from "@chatai/ai";
import type { AssistantOverview, KeyFact, OverviewClaim } from "@chatai/database";
import { nanoid } from "nanoid";

import type { ProviderUsageRecord } from "./provider-usage";

const MAX_CLAIMS = 4;
const MAX_CLAIM_CHARS = 280;

/**
 * Draft an overview suggestion from published key facts.
 * Never served until the owner approves. Each claim must reference fact ids.
 */
export async function suggestOverview(opts: {
  facts: KeyFact[];
  represents: string | null;
  chat: ChatConfig;
  generate?: GenerateChatFn;
  now: string;
}): Promise<{ overview: AssistantOverview | null; usages: ProviderUsageRecord[] }> {
  const facts = opts.facts.slice(0, 12);
  if (facts.length < 1) {
    return { overview: null, usages: [] };
  }

  const generate = opts.generate ?? generateChat;
  const result = await runGenerateChat(generate, {
    config: opts.chat,
    system: [
      "You draft a short overview of a person or organization from numbered key facts.",
      'Return ONLY JSON: {"claims":[{"text":"...","factIds":["id1","id2"]}]}',
      `Write 2 to ${MAX_CLAIMS} claims. Each claim must be supported by the listed factIds only.`,
      `Each claim text is at most ${MAX_CLAIM_CHARS} characters. No marketing fluff or unsupported praise.`,
      "factIds must be a non-empty subset of the supplied fact ids. Never invent fact ids.",
    ].join("\n"),
    prompt: JSON.stringify({
      represents: opts.represents,
      facts: facts.map((fact) => ({
        id: fact.id,
        topic: fact.topic,
        text: fact.text,
      })),
    }),
  });

  const usages: ProviderUsageRecord[] = [
    {
      kind: "chat_completion",
      provider: opts.chat.provider,
      model: opts.chat.model,
      usage: result.usage,
      step: "profile_overview",
    },
  ];

  const claims = parseOverviewClaims(result.text, facts);
  if (claims.length === 0) return { overview: null, usages };

  return {
    overview: {
      status: "suggestion",
      version: 1,
      claims,
      suggestedAt: opts.now,
      approvedAt: null,
      approvedBy: null,
    },
    usages,
  };
}

export function parseOverviewClaims(raw: string, facts: KeyFact[]): OverviewClaim[] {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) as {
      claims?: unknown;
    };
    if (!Array.isArray(parsed.claims)) return [];
    const claims: OverviewClaim[] = [];
    for (const item of parsed.claims.slice(0, MAX_CLAIMS)) {
      if (!item || typeof item !== "object") continue;
      const record = item as { text?: unknown; factIds?: unknown };
      const text =
        typeof record.text === "string" ? record.text.replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM_CHARS) : "";
      if (text.length < 12) continue;
      const factIds = Array.isArray(record.factIds)
        ? [...new Set(record.factIds.filter((id): id is string => typeof id === "string" && factById.has(id)))]
        : [];
      if (factIds.length === 0) continue;
      const sources = factIds.flatMap((id) => factById.get(id)?.sources ?? []);
      claims.push({
        id: nanoid(10),
        text,
        factIds,
        sources,
      });
    }
    return claims;
  } catch {
    return [];
  }
}

/** Build an overview from owner-edited claim texts linked to fact ids (pre-approve). */
export function overviewFromEditedClaims(
  claims: Array<{ id?: string; text: string; factIds: string[] }>,
  facts: KeyFact[],
  prior: AssistantOverview | null,
  now: string,
): AssistantOverview | { error: string } {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const built: OverviewClaim[] = [];
  for (const claim of claims.slice(0, MAX_CLAIMS)) {
    const text = claim.text.replace(/\s+/g, " ").trim().slice(0, MAX_CLAIM_CHARS);
    if (text.length < 12) return { error: "Each overview claim needs at least 12 characters." };
    const factIds = [...new Set(claim.factIds.filter((id) => factById.has(id)))];
    if (factIds.length === 0) {
      return { error: "Each overview claim must reference at least one published key fact." };
    }
    built.push({
      id: claim.id?.trim() || nanoid(10),
      text,
      factIds,
      sources: factIds.flatMap((id) => factById.get(id)?.sources ?? []),
    });
  }
  if (built.length === 0) return { error: "Add at least one overview claim." };
  return {
    status: "suggestion",
    version: (prior?.version ?? 0) + 1,
    claims: built,
    suggestedAt: prior?.suggestedAt ?? now,
    approvedAt: null,
    approvedBy: null,
  };
}
