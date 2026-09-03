import { generateChat, runGenerateChat, type ChatConfig, type GenerateChatFn } from "@chatai/ai";

export const EXPANSION_TOKEN_THRESHOLD = 12;
export const EXPANSION_ALTERNATE_COUNT = 2;

export type ExpandQueryResult = {
  queries: string[];
  expanded: boolean;
  alternates: string[];
  usage?: import("@chatai/ai").ProviderUsage;
};

export type ExpandQueryDeps = {
  generateChat: GenerateChatFn;
};

function countTokens(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function dedupeQueries(queries: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const query of queries) {
    const normalized = query.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(query.trim());
  }

  return unique;
}

function parseAlternateQueries(raw: string, originalQuery: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Fall back to line-based parsing below.
  }

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^\d+[).-]\s+/, "").trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== originalQuery.toLowerCase());
}

export async function expandQueries(opts: {
  query: string;
  chat: ChatConfig;
  enabled?: boolean;
  deps?: Partial<ExpandQueryDeps>;
}): Promise<ExpandQueryResult> {
  const query = opts.query.trim();
  const enabled = opts.enabled ?? true;

  if (!enabled || !query || countTokens(query) >= EXPANSION_TOKEN_THRESHOLD) {
    return { queries: [query], expanded: false, alternates: [] };
  }

  const generate = opts.deps?.generateChat ?? generateChat;

  try {
    const { text: raw, usage } = await runGenerateChat(generate, {
      config: opts.chat,
      system:
        "Generate alternate search queries for retrieval. Return ONLY a JSON array of strings with no markdown.",
      prompt: `Original query: ${query}\n\nWrite ${EXPANSION_ALTERNATE_COUNT} alternate search queries that capture different phrasings or synonyms. Return JSON like ["query one","query two"].`,
    });

    const alternates = parseAlternateQueries(raw, query).slice(0, EXPANSION_ALTERNATE_COUNT);
    const queries = dedupeQueries([query, ...alternates]);

    return {
      queries,
      expanded: alternates.length > 0,
      alternates,
      usage,
    };
  } catch {
    return { queries: [query], expanded: false, alternates: [] };
  }
}
