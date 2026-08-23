import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";

import "./global.css";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
