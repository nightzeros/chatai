import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Syne } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { brand } from "@/lib/site";

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
