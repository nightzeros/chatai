import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { hasCredentials, isHttpUrl, normalizeUrl } from "./url";

export type HostLookup = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: HostLookup = (hostname) =>
  dnsLookup(hostname).then((records) =>
    Array.isArray(records) ? records : [records],
  );

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  return false;
}

export function isBlockedAddress(address: string) {
  if (address === "169.254.169.254") return true;
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

export async function assertSafeUrl(raw: string, lookup: HostLookup = defaultLookup) {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    throw new Error("Website URLs must use http or https.");
  }

  const url = normalizeUrl(raw);
  if (!isHttpUrl(url)) {
    throw new Error("Website URLs must use http or https.");
  }
  if (hasCredentials(url)) {
    throw new Error("Website URLs cannot include credentials.");
  }
  if (BLOCKED_HOSTNAMES.has(url.hostname)) {
    throw new Error("Website URLs cannot target restricted hosts.");
  }

  if (isIP(url.hostname)) {
    if (isBlockedAddress(url.hostname)) {
      throw new Error("Website URLs cannot target private or restricted addresses.");
    }
    return url;
  }

  const records = await lookup(url.hostname);
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new Error("Website URLs cannot target private or restricted addresses.");
    }
  }

  return url;
}
