export const WIDGET_ASSET_PATH = "/widget/chat.js";

/**
 * The URL is stable, so a deploy reaches visitors only once their cached copy expires.
 * Keep the window short: a stale widget can be refused by a newer server contract.
 */
export const WIDGET_ASSET_MAX_AGE_SECONDS = 300;

export const widgetAssetHeaders = [
  { key: "Cache-Control", value: `public, max-age=${WIDGET_ASSET_MAX_AGE_SECONDS}, must-revalidate` },
  { key: "X-Content-Type-Options", value: "nosniff" },
];
