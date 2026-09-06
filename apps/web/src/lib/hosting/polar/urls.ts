export const DEFAULT_BILLING_RETURN_PATH = "/dashboard/billing";

export function defaultBillingReturnUrl(origin: string): string {
  return `${origin}${DEFAULT_BILLING_RETURN_PATH}`;
}

export function defaultCheckoutSuccessUrl(origin: string): string {
  return `${origin}${DEFAULT_BILLING_RETURN_PATH}?checkout_id={CHECKOUT_ID}`;
}

/**
 * Accept same-origin absolute URLs or relative paths starting with a single `/`.
 * Returns null when a candidate is present but not same-origin.
 */
export function resolveSameOriginUrl(
  origin: string,
  candidate: unknown,
  fallback: string,
): string | null {
  if (candidate == null || candidate === "") {
    return fallback;
  }
  if (typeof candidate !== "string") return null;

  const trimmed = candidate.trim();
  if (!trimmed) return fallback;
  if (
    trimmed.startsWith("//") ||
    /^\s*javascript:/i.test(trimmed) ||
    /^\s*data:/i.test(trimmed)
  ) {
    return null;
  }

  try {
    const originUrl = new URL(origin);
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
      return `${originUrl.origin}${trimmed}`;
    }

    const candidateUrl = new URL(trimmed);
    if (candidateUrl.origin !== originUrl.origin) return null;
    if (candidateUrl.protocol !== "http:" && candidateUrl.protocol !== "https:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}
