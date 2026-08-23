"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

import { useIsDark } from "@/lib/use-is-dark";

/**
 * Interactive OpenAPI explorer.
 *
 * Default: docs-bundled spec from `GET /api/openapi` (same generator as ChatAI).
 * Override with `NEXT_PUBLIC_CHATAI_DOCS_API_URL` to load a live instance
 * (`{url}/api/v1/openapi.json`) when testing against a running deployment.
 */
export function OpenApiExplorer() {
  const isDark = useIsDark();
  const liveBase = process.env.NEXT_PUBLIC_CHATAI_DOCS_API_URL?.replace(/\/+$/, "");
  const url = liveBase ? `${liveBase}/api/v1/openapi.json` : "/api/openapi";

  return (
    <div className="openapi-explorer not-prose -mx-2 overflow-hidden rounded-lg border border-fd-border md:-mx-4">
      <ApiReferenceReact
        configuration={{
          url,
          layout: "modern",
          theme: "default",
          hideDarkModeToggle: true,
          forceDarkModeState: isDark ? "dark" : "light",
        }}
      />
    </div>
  );
}
