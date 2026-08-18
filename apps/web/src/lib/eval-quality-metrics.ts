export type EvalQualityAverages = Record<string, number>;

export type EvalQualityFailure = {
  metric: string;
  score: number;
  kind: "online" | "offline";
  createdAt: string;
};

export type EvalQualityLastRun = {
  id: string;
  kind: "online" | "offline";
  status: string;
  createdAt: string;
  summary: {
    caseCount?: number;
    scoredCount?: number;
    averages?: Record<string, number>;
    error?: string;
  } | null;
};

export type EvalQuality = {
  averages: EvalQualityAverages;
  lastRun: EvalQualityLastRun | null;
  recentFailures: EvalQualityFailure[];
};

export type EvalQualityAverageRow = { metric: string; average: number | string | null };
export type EvalQualityFailureRow = {
  metric: string;
  score: number | string;
  kind: "online" | "offline";
  createdAt: Date | string;
};
export type EvalQualityLastRunRow = {
  id: string;
  kind: "online" | "offline";
  status: string;
  createdAt: Date | string;
  summary: EvalQualityLastRun["summary"];
};

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toEvalQuality(opts: {
  averages: EvalQualityAverageRow[];
  lastRun: EvalQualityLastRunRow | null;
  failures: EvalQualityFailureRow[];
}): EvalQuality {
  const averages: EvalQualityAverages = {};
  for (const row of opts.averages) {
    const value = row.average == null ? null : Number(row.average);
    if (value == null || !Number.isFinite(value)) continue;
    averages[row.metric] = Number(value.toFixed(3));
  }

  return {
    averages,
    lastRun: opts.lastRun
      ? {
          id: opts.lastRun.id,
          kind: opts.lastRun.kind,
          status: opts.lastRun.status,
          createdAt: toIso(opts.lastRun.createdAt),
          summary: opts.lastRun.summary,
        }
      : null,
    recentFailures: opts.failures.map((row) => ({
      metric: row.metric,
      score: Number(Number(row.score).toFixed(3)),
      kind: row.kind,
      createdAt: toIso(row.createdAt),
    })),
  };
}
