/** Reciprocal rank fusion constant (standard default). */
export const RRF_K = 60;

/**
 * Fuse multiple ranked lists into RRF scores keyed by item id.
 * Higher score = better fused rank.
 */
export function reciprocalRankFusion(lists: Array<Array<{ id: string }>>, k = RRF_K) {
  const scores = new Map<string, number>();

  for (const list of lists) {
    list.forEach((item, index) => {
      const rank = index + 1;
      const increment = 1 / (k + rank);
      scores.set(item.id, (scores.get(item.id) ?? 0) + increment);
    });
  }

  return scores;
}

/** Map an RRF score to 0–1 using the theoretical maximum (rank 1 in every list). */
export function normalizeRrfScore(score: number, listCount: number, k = RRF_K) {
  const maxScore = (listCount / (k + 1));
  if (maxScore <= 0) return 0;
  return Math.min(1, score / maxScore);
}

export function sortByRrfScore<T extends { chunkId: string }>(
  items: T[],
  scores: Map<string, number>,
  limit: number,
) {
  return [...items]
    .sort((a, b) => (scores.get(b.chunkId) ?? 0) - (scores.get(a.chunkId) ?? 0))
    .slice(0, limit);
}
