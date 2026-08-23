import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ["@chatai/react", "@chatai/widget", "@chatai/widget-core"],
  outputFileTracingRoot: path.join(appDir, "../.."),
};

export default config;
