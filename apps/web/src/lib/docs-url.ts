import { env } from "@/lib/env";

/**
 * Public docs site URL. Prefer NEXT_PUBLIC_DOCS_URL; otherwise derive from
 * BETTER_AUTH_URL by swapping port 3000 → 3001 in local/dev, else same origin /docs.
 */
export function getDocsUrl(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DOCS_URL) {
    return process.env.NEXT_PUBLIC_DOCS_URL.replace(/\/+$/, "");
  }

  const base = env.BETTER_AUTH_URL ?? "http://localhost:3000";
  try {
    const url = new URL(base);
    if (url.port === "3000" || (!url.port && url.hostname === "localhost")) {
      url.port = "3001";
      return url.origin;
    }
    return `${url.origin}/docs`;
  } catch {
    return "http://localhost:3001";
  }
}
