/**
 * Pooled and direct URLs may use different hosts, but they must reach the same
 * database. A direct URL copied from another Neon branch silently splits writes:
 * the app reads one branch while migrations and the ingest worker use another.
 */
export type DatabaseUrlMismatch = { reason: string };

function neonEndpointId(hostname: string): string | null {
  if (!hostname.endsWith(".neon.tech")) return null;
  const label = hostname.split(".")[0] ?? "";
  return label.replace(/-pooler$/, "");
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function checkDatabaseUrlPair(
  pooledUrl: string | undefined,
  directUrl: string | undefined,
): DatabaseUrlMismatch | null {
  if (!pooledUrl || !directUrl) return null;
  const pooled = parse(pooledUrl);
  const direct = parse(directUrl);
  if (!pooled || !direct) return null;

  const pooledDb = pooled.pathname.replace(/^\//, "");
  const directDb = direct.pathname.replace(/^\//, "");
  if (pooledDb && directDb && pooledDb !== directDb) {
    return {
      reason: `DATABASE_URL uses database "${pooledDb}" but DATABASE_URL_UNPOOLED uses "${directDb}".`,
    };
  }

  const pooledEndpoint = neonEndpointId(pooled.hostname);
  const directEndpoint = neonEndpointId(direct.hostname);
  if (pooledEndpoint && directEndpoint && pooledEndpoint !== directEndpoint) {
    return {
      reason: `DATABASE_URL targets Neon endpoint ${pooledEndpoint} but DATABASE_URL_UNPOOLED targets ${directEndpoint} (a different branch or project). Use the direct URL of the same endpoint (host without "-pooler").`,
    };
  }
  return null;
}
