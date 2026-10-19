import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

import { WIDGET_ASSET_PATH, widgetAssetHeaders } from "./src/lib/widget-delivery";

const appDir = path.dirname(fileURLToPath(import.meta.url));

// Load monorepo root .env (Next only auto-loads apps/web/.env by default)
loadEnv({ path: path.join(appDir, "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@chatai/database",
    "@chatai/ai",
    "@chatai/evals",
    "@chatai/rag",
    "@chatai/voice",
    "@nightzeros/chatai-react",
    "@nightzeros/chatai-widget",
    "@nightzeros/chatai-widget-core",
  ],
  outputFileTracingRoot: path.join(appDir, "../.."),
  // `ws` has optional native deps (bufferutil/utf-8-validate); keep it external.
  serverExternalPackages: ["unpdf", "mammoth", "ws", "@audio/encode-opus", "mediabunny"],
  async headers() {
    return [{ source: WIDGET_ASSET_PATH, headers: widgetAssetHeaders }];
  },
  async redirects() {
    // Assistant workspace hubs (keep bookmarks working). Page-level redirects also exist.
    return [
      {
        source: "/dashboard/assistants/:id/profile",
        destination: "/dashboard/assistants/:id/identity",
        permanent: false,
      },
      {
        source: "/dashboard/assistants/:id/customize",
        destination: "/dashboard/assistants/:id/widget?tab=appearance",
        permanent: false,
      },
      {
        source: "/dashboard/assistants/:id/install",
        destination: "/dashboard/assistants/:id/widget?tab=embed",
        permanent: false,
      },
      {
        source: "/dashboard/assistants/:id/analytics",
        destination: "/dashboard/assistants/:id/insights",
        permanent: false,
      },
      {
        source: "/dashboard/assistants/:id/evals",
        destination: "/dashboard/assistants/:id/insights/evals",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
