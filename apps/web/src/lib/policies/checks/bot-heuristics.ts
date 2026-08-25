const VISITOR_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

const BOT_UA_PATTERNS = [
  /^$/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bpython-requests\b/i,
  /\bpython-urllib\b/i,
  /\bhttpie\b/i,
  /\bgo-http-client\b/i,
  /\bjava\//i,
  /\blibwww-perl\b/i,
  /\bscrapy\b/i,
];

export type BotCheckInput = {
  visitorId?: string | null;
  /** When set, this is a chat send — visitorId is required and burst is checked. */
  message?: string | null;
  userAgent?: string | null;
  assistantId: string;
  now?: Date;
  /** Test seam for burst tracking. */
  checkBurst?: (key: string, now: Date) => boolean;
};

export type BotCheckResult = { ok: true } | { ok: false; reason: string };

export function isValidVisitorId(visitorId: string | null | undefined): boolean {
  return typeof visitorId === "string" && VISITOR_ID_PATTERN.test(visitorId);
}

export function isSuspiciousUserAgent(userAgent: string | null | undefined): boolean {
  if (userAgent == null) {
    return true;
  }
  const ua = userAgent.trim();
  if (!ua) {
    return true;
  }
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(ua));
}

/**
 * Best-effort per-process burst tracker (not shared across instances).
 * Rejects when more than `maxEvents` occur within `windowMs`.
 */
const burstTimestamps = new Map<string, number[]>();
const BURST_WINDOW_MS = 2_000;
const BURST_MAX_EVENTS = 3;
const BURST_MAP_MAX_KEYS = 10_000;

export function clearBurstTracker() {
  burstTimestamps.clear();
}

export function recordBurstAndAllow(
  key: string,
  now = new Date(),
  windowMs = BURST_WINDOW_MS,
  maxEvents = BURST_MAX_EVENTS,
): boolean {
  const nowMs = now.getTime();
  const prior = burstTimestamps.get(key) ?? [];
  const recent = prior.filter((t) => nowMs - t < windowMs);

  if (recent.length >= maxEvents) {
    burstTimestamps.set(key, recent);
    return false;
  }

  recent.push(nowMs);
  burstTimestamps.set(key, recent);

  // Bound memory: drop oldest keys if the map grows too large.
  if (burstTimestamps.size > BURST_MAP_MAX_KEYS) {
    const oldest = burstTimestamps.keys().next().value;
    if (oldest !== undefined) {
      burstTimestamps.delete(oldest);
    }
  }

  return true;
}

/**
 * Lightweight bot heuristics for public widget traffic.
 * Returns `{ ok: false, reason }` for server-side diagnostics only.
 */
export function evaluateBotHeuristics(input: BotCheckInput): BotCheckResult {
  const isChatSend = input.message !== undefined && input.message !== null;

  // Config fetches often have neither message nor visitorId — skip.
  if (!isChatSend && !input.visitorId) {
    return { ok: true };
  }

  if (!isValidVisitorId(input.visitorId)) {
    return { ok: false, reason: "bot_invalid_visitor_id" };
  }

  if (isSuspiciousUserAgent(input.userAgent)) {
    return { ok: false, reason: "bot_suspicious_user_agent" };
  }

  if (isChatSend) {
    const content = input.message?.trim() ?? "";
    if (!content) {
      return { ok: false, reason: "bot_empty_message" };
    }

    const now = input.now ?? new Date();
    const burstKey = `${input.assistantId}:${input.visitorId}`;
    const checkBurst = input.checkBurst ?? recordBurstAndAllow;
    if (!checkBurst(burstKey, now)) {
      return { ok: false, reason: "bot_burst" };
    }
  }

  return { ok: true };
}
