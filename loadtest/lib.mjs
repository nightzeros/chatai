#!/usr/bin/env node
/* global console, process */

import { performance } from "node:perf_hooks";

const BASE_URL = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "10");
const REQUESTS = Number(process.env.REQUESTS ?? "50");

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export async function runPool(total, concurrency, worker) {
  const latencies = [];
  let failures = 0;
  let next = 0;

  async function runOne() {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const start = performance.now();
      try {
        await worker(i);
        latencies.push(performance.now() - start);
      } catch {
        failures += 1;
        latencies.push(performance.now() - start);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => runOne()));
  latencies.sort((a, b) => a - b);
  return {
    total,
    failures,
    errorRate: failures / total,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

export function printStats(label, stats) {
  console.log(
    `[loadtest] ${label}: n=${stats.total} errors=${stats.failures} (${(stats.errorRate * 100).toFixed(1)}%) ` +
      `p50=${stats.p50.toFixed(0)}ms p95=${stats.p95.toFixed(0)}ms p99=${stats.p99.toFixed(0)}ms`,
  );
}

export { BASE_URL, CONCURRENCY, REQUESTS };
