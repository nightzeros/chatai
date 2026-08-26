import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { brand } from "@/lib/brand";

import "./global.css";

export const metadata: Metadata = {
  title: {
    default: "ChatAI Docs",
    template: "%s · ChatAI Docs",
  },
  description: `Documentation for ChatAI — open-source AI assistants grounded in your knowledge. A ${brand.company.name} project.`,
  applicationName: "ChatAI Docs",
  openGraph: {
    title: "ChatAI Docs",
    description: `Install, self-host, and embed ChatAI. A ${brand.company.name} open-source project.`,
    siteName: "ChatAI Docs",
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
