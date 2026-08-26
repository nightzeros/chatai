#!/usr/bin/env node
/* global console, process */

import { BASE_URL, CONCURRENCY, REQUESTS, printStats, runPool } from "./lib.mjs";

const ASSISTANT_ID = process.env.ASSISTANT_ID;
const CHAT_MESSAGE = process.env.CHAT_MESSAGE ?? "What is the refund period?";

if (!ASSISTANT_ID) {
  console.error("ASSISTANT_ID is required (public asst_… id).");
  process.exit(1);
}

const url = `${BASE_URL}/api/v1/chat`;

const stats = await runPool(REQUESTS, CONCURRENCY, async (i) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assistantId: ASSISTANT_ID,
      message: CHAT_MESSAGE,
      visitorId: `loadtest_${i}_${Date.now().toString(36)}`,
      source: "widget",
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
});

printStats("POST /chat", stats);
if (stats.errorRate > 0.05) {
  console.error("[loadtest] chat error rate exceeds 5% soft SLO");
  process.exit(1);
}
