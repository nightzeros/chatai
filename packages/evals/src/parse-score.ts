export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export type JudgeVerdict = {
  score: number;
  reason?: string;
};

function readJudgeVerdict(parsed: unknown): JudgeVerdict | null {
  if (typeof parsed !== "object" || parsed === null || !("score" in parsed)) {
    return null;
  }

  const record = parsed as { score: unknown; reason?: unknown };
  const reason = typeof record.reason === "string" && record.reason.trim() ? record.reason.trim() : undefined;
  return {
    score: clampScore(Number(record.score)),
    ...(reason ? { reason } : {}),
  };
}

export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const trimmed = raw.trim();
  if (!trimmed) return { score: 0 };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const verdict = readJudgeVerdict(parsed);
    if (verdict) return verdict;
  } catch {
    // Fall back to numeric parsing below.
  }

  const match = trimmed.match(/\b(1(?:\.0+)?|0\.\d+|0)\b/);
  if (match) {
    return { score: clampScore(Number(match[1])) };
  }

  return { score: 0 };
}

export function parseJudgeScore(raw: string) {
  return parseJudgeVerdict(raw).score;
}
