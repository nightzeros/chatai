import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));

// Load monorepo root .env (Next only auto-loads apps/web/.env by default)
loadEnv({ path: path.join(appDir, "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@chatai/database", "@chatai/ai", "@chatai/rag"],
  outputFileTracingRoot: path.join(appDir, "../.."),
  serverExternalPackages: ["unpdf", "mammoth"],
};

export default nextConfig;
