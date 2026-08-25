import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";

const display = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "ChatAI",
    template: "%s · ChatAI",
  },
  description:
    "Open-source platform to create AI assistants with your knowledge and embed them on your website.",
  applicationName: "ChatAI",
  openGraph: {
    title: "ChatAI",
    description:
      "Create AI assistants on your knowledge, test answers with citations, and embed a chat widget. Open source and self-hostable.",
    type: "website",
    siteName: "ChatAI",
  },
  twitter: {
    card: "summary",
    title: "ChatAI",
    description: "Open-source AI assistants on your knowledge.",
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
