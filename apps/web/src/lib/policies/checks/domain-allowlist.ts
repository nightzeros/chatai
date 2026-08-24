/**
 * Normalize an allowlist entry to a hostname pattern.
 * Accepts "example.com", "*.vercel.app", or full URLs (host only).
 * Returns null when the input is empty or invalid.
 */
export function parseAllowedDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  let host: string;
  if (trimmed.includes("://")) {
    try {
      const url = new URL(trimmed);
      host = url.hostname.toLowerCase();
    } catch {
      return null;
    }
  } else if (trimmed.includes("/")) {
    try {
      const url = new URL(`https://${trimmed}`);
      host = url.hostname.toLowerCase();
    } catch {
      return null;
    }
  } else if (/:\d+$/.test(trimmed) && !trimmed.startsWith("*.")) {
    // host:port without scheme
    host = trimmed.replace(/:\d+$/, "");
  } else {
    host = trimmed;
  }

  if (!host || host.includes("/") || host.includes(" ")) {
    return null;
  }

  if (host.startsWith("*.")) {
    const rest = host.slice(2);
    if (!rest || rest.includes("*") || !isValidHostname(rest)) {
      return null;
    }
    return `*.${rest}`;
  }

  if (host.includes("*") || !isValidHostname(host)) {
    return null;
  }

  return host;
}

function isValidHostname(host: string): boolean {
  if (host === "localhost") {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true;
  }
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(host);
}

/**
 * Extract hostname from Origin, falling back to Referer.
 * Returns null when missing or malformed.
 */
export function requestOriginHostname(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin != null && origin !== "" && origin !== "null") {
    return hostnameFromHeaderValue(origin);
  }

  const referer = request.headers.get("referer");
  if (referer) {
    return hostnameFromHeaderValue(referer);
  }

  return null;
}

function hostnameFromHeaderValue(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    const host = url.hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Empty allowlist = allow all (backward compatible).
 * Non-empty: hostname must match an exact entry or `*.suffix` wildcard.
 * Missing/malformed origin is denied when an allowlist is configured.
 */
export function isOriginAllowed(
  hostname: string | null,
  allowedDomains: string[],
): boolean {
  const patterns = allowedDomains
    .map(parseAllowedDomain)
    .filter((d): d is string => d != null);

  if (patterns.length === 0) {
    return true;
  }

  if (!hostname) {
    return false;
  }

  const host = hostname.toLowerCase();

  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1); // ".example.com"
      if (host.endsWith(suffix) && host.length > suffix.length) {
        return true;
      }
      continue;
    }
    if (host === pattern) {
      return true;
    }
  }

  return false;
}
