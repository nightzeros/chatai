import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();
const appDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(appDir, "../.."),
  transpilePackages: ["@nightzeros/chatai-sdk", "@scalar/api-reference-react"],
};

export default withMDX(config);
