import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { OpenApiExplorer } from "@/components/openapi-explorer";

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    OpenApiExplorer,
    ...components,
  };
}
