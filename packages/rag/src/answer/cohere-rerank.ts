import { emptyProviderUsage, type ProviderUsage } from "@chatai/ai";

export type CohereRerankResult = {
  index: number;
  relevanceScore: number;
};

export type CohereRerankResponse = {
  results: CohereRerankResult[];
  usage: ProviderUsage;
  model: string;
  provider: "cohere";
};

const COHERE_RERANK_MODEL = "rerank-english-v3.0";

export async function cohereRerank(opts: {
  apiKey: string;
  query: string;
  documents: string[];
  topN: number;
  fetchImpl?: typeof fetch;
}): Promise<CohereRerankResponse> {
  if (opts.documents.length === 0) {
    return {
      results: [],
      usage: emptyProviderUsage(),
      model: COHERE_RERANK_MODEL,
      provider: "cohere",
    };
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const response = await fetchFn("https://api.cohere.com/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: COHERE_RERANK_MODEL,
      query: opts.query,
      documents: opts.documents,
      top_n: Math.min(opts.topN, opts.documents.length),
      return_documents: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Cohere rerank failed (${response.status}): ${body || response.statusText}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{ index: number; relevance_score: number }>;
  };

  return {
    results: (payload.results ?? []).map((item) => ({
      index: item.index,
      relevanceScore: item.relevance_score,
    })),
    // Cohere bills per request; token fields stay 0 and metering uses units=1.
    usage: emptyProviderUsage(),
    model: COHERE_RERANK_MODEL,
    provider: "cohere",
  };
}
