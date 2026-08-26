#!/usr/bin/env node
/* global console, process */

import { BASE_URL, CONCURRENCY, REQUESTS, printStats, runPool } from "./lib.mjs";

const ASSISTANT_ID = process.env.ASSISTANT_ID;
if (!ASSISTANT_ID) {
  console.error("ASSISTANT_ID is required (public asst_… id).");
  process.exit(1);
}

const url = `${BASE_URL}/api/v1/assistants/${encodeURIComponent(ASSISTANT_ID)}/config`;

const stats = await runPool(REQUESTS, CONCURRENCY, async () => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await response.json();
});

printStats("GET /config", stats);
if (stats.errorRate > 0.01) {
  console.error("[loadtest] config error rate exceeds 1% soft SLO");
  process.exit(1);
}
