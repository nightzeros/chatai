import type { Metadata } from "next";
import localFont from "next/font/local";

import { ThemeProvider } from "@/components/theme-provider";
import { brand } from "@/lib/site";

import "./globals.css";

// Self-hosted (SIL OFL, see ./fonts): builds never depend on fetching Google Fonts.
const display = localFont({
  variable: "--font-display",
  src: [
    { path: "./fonts/syne-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/syne-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/syne-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

const body = localFont({
  variable: "--font-body",
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
});

const mono = localFont({
  variable: "--font-mono",
  adjustFontFallback: false,
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

const metadataBase =
  process.env.NEXT_PUBLIC_APP_URL != null
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : new URL(brand.product.appUrl);

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "ChatAI",
    template: "%s · ChatAI",
  },
  description:
    "Build AI assistants grounded in your own knowledge and embed them anywhere. An open-source project by NightZeros.",
  applicationName: "ChatAI",
  authors: [{ name: brand.company.name, url: brand.company.url }],
  creator: brand.company.name,
  openGraph: {
    title: "ChatAI — Open-source AI Assistants by NightZeros",
    description:
      "Create AI assistants on your knowledge, test answers with citations, and embed a chat widget. Open source and self-hostable.",
    type: "website",
    siteName: "ChatAI",
  },
  twitter: {
    card: "summary_large_image",
    title: "ChatAI — Open-source AI Assistants by NightZeros",
    description: "Open-source AI assistants on your knowledge. A NightZeros project.",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-16.svg", type: "image/svg+xml", sizes: "16x16" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
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
