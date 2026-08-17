const BINARY_EXTENSIONS = new Set([
  "pdf",
  "zip",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "mp4",
  "woff",
  "woff2",
]);

export function normalizeUrl(raw: string): URL {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return normalizeDefaultPort(url);
}

export function normalizeDefaultPort(url: URL) {
  if (url.protocol === "https:" && url.port === "443") {
    url.port = "";
  }
  if (url.protocol === "http:" && url.port === "80") {
    url.port = "";
  }
  return url;
}

/** Canonical start URL stored on website sources (path kept; query + hash removed). */
export function normalizeSourceStartUrl(raw: string) {
  const url = normalizeUrl(raw);
  url.search = "";
  return url.toString();
}

/**
 * Stable website identity per assistant. Uses URL origin (scheme + host + port)
 * so https://example.com/docs and https://example.com/ are treated as one site.
 * Query strings are ignored for identity; they are not part of the origin.
 */
export function normalizeWebsiteOriginKey(raw: string) {
  const url = normalizeUrl(raw);
  url.search = "";
  return url.origin;
}

export function normalizeUrlString(raw: string) {
  return normalizeUrl(raw).toString();
}

export function sameOrigin(a: URL, b: URL) {
  return a.protocol === b.protocol && a.host === b.host;
}

export function isHttpUrl(url: URL) {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function hasCredentials(url: URL) {
  return Boolean(url.username || url.password);
}

export function isBinaryPath(url: URL) {
  const ext = url.pathname.split(".").pop()?.toLowerCase() ?? "";
  return BINARY_EXTENSIONS.has(ext);
}

export function pageNameFromUrl(url: URL) {
  const segment = url.pathname.split("/").filter(Boolean).pop();
  return segment ? decodeURIComponent(segment) : url.hostname;
}
