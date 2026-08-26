#!/usr/bin/env node
/* global console, process */

import { performance } from "node:perf_hooks";

import { BASE_URL } from "./lib.mjs";

const healthUrl = `${BASE_URL}/api/health`;
const start = performance.now();
const response = await fetch(healthUrl);
const ms = performance.now() - start;

if (!response.ok) {
  console.error(`[loadtest] health check failed: HTTP ${response.status}`);
  process.exit(1);
}

const body = await response.json().catch(() => ({}));
console.log(`[loadtest] GET /api/health ${ms.toFixed(0)}ms →`, body);

if (ms > 2000) {
  console.error("[loadtest] health latency exceeds 2s soft smoke gate");
  process.exit(1);
}

const assistantId = process.env.ASSISTANT_ID;
if (assistantId) {
  const configStart = performance.now();
  const configResponse = await fetch(
    `${BASE_URL}/api/v1/assistants/${encodeURIComponent(assistantId)}/config`,
  );
  const configMs = performance.now() - configStart;
  if (!configResponse.ok) {
    console.error(`[loadtest] config smoke failed: HTTP ${configResponse.status}`);
    process.exit(1);
  }
  console.log(`[loadtest] GET …/config ${configMs.toFixed(0)}ms OK`);
} else {
  console.log("[loadtest] ASSISTANT_ID unset — skipped config smoke");
}

console.log("[loadtest] smoke passed");
