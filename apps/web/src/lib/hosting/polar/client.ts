import { Polar } from "@polar-sh/sdk";

import { env } from "@/lib/env";

let _polar: Polar | null = null;

/**
 * Lazily initialized Polar client. Returns null when POLAR_ACCESS_TOKEN is not configured.
 */
export function getPolar(): Polar | null {
  if (!env.POLAR_ACCESS_TOKEN) return null;
  if (!_polar) {
    _polar = new Polar({
      accessToken: env.POLAR_ACCESS_TOKEN,
      server: env.POLAR_SERVER,
    });
  }
  return _polar;
}

export function requirePolar(): Polar {
  const polar = getPolar();
  if (!polar) {
    throw new Error("Polar is not configured. Set POLAR_ACCESS_TOKEN.");
  }
  return polar;
}
