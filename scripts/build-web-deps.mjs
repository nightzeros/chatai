#!/usr/bin/env node
/* global console, process */
/**
 * Builds the workspace packages the web app imports from `dist` (widget-core, widget,
 * react, sdk) before `next build` / `next dev`, so a standalone web build (Docker,
 * `pnpm --filter @chatai/web build`) never uses stale or missing package builds.
 *
 * `turbo run build` has already built them (`dependsOn: ["^build"]`); rebuilding here
 * would clean their `dist` while other apps read it in parallel.
 */
import { execSync } from "node:child_process";

if (process.env.TURBO_HASH && process.env.npm_lifecycle_event === "prebuild") {
  console.log("[web] Workspace packages already built by turbo (^build).");
} else {
  execSync('pnpm --filter "@chatai/web^..." build', { stdio: "inherit" });
}
