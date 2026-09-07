import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { brand, GITHUB_REPO_URL } from "@/lib/brand";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-[0.3rem] border border-fd-border bg-fd-muted font-mono text-[10px] tracking-wide"
        >
          N0
        </span>
        <span className="font-semibold tracking-tight">ChatAI Docs</span>
      </span>
    ),
  },
  links: [
    {
      text: brand.company.name,
      url: brand.company.url,
      external: true,
    },
    {
      text: "Open ChatAI",
      url: brand.product.appUrl,
      external: true,
    },
    {
      text: "GitHub",
      url: GITHUB_REPO_URL,
      external: true,
    },
  ],
};
