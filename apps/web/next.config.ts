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
  transpilePackages: ["@chatai/database", "@chatai/ai", "@chatai/rag", "@chatai/react", "@chatai/widget", "@chatai/widget-core"],
  outputFileTracingRoot: path.join(appDir, "../.."),
  serverExternalPackages: ["unpdf", "mammoth"],
  async headers() {
    return [{ source: WIDGET_ASSET_PATH, headers: widgetAssetHeaders }];
  },
};

export default nextConfig;
