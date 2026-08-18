export type CohereRerankResult = {
  index: number;
  relevanceScore: number;
};

export async function cohereRerank(opts: {
  apiKey: string;
  query: string;
  documents: string[];
  topN: number;
  fetchImpl?: typeof fetch;
}): Promise<CohereRerankResult[]> {
  if (opts.documents.length === 0) {
    return [];
  }

  const fetchFn = opts.fetchImpl ?? fetch;
  const response = await fetchFn("https://api.cohere.com/v1/rerank", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "rerank-english-v3.0",
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

  return (payload.results ?? []).map((item) => ({
    index: item.index,
    relevanceScore: item.relevance_score,
  }));
}
