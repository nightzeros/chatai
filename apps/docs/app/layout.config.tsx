import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { brand, GITHUB_REPO_URL } from "@/lib/brand";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: "ChatAI Docs",
  },
  links: [
    {
      text: brand.company.name,
      url: brand.company.url,
      external: true,
    },
    {
      text: "GitHub",
      url: GITHUB_REPO_URL,
      external: true,
    },
  ],
};
