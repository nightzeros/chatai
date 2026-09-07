import { JetBrains_Mono, Manrope } from "next/font/google";
import Link from "next/link";

import { brand, GITHUB_REPO_URL } from "@/lib/brand";

const display = Manrope({
  subsets: ["latin"],
  variable: "--font-nz-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-nz-mono",
  display: "swap",
});

const paths = [
  {
    href: "/docs/installation",
    label: "01",
    title: "Install",
    blurb: "Local setup, env, and first assistant.",
  },
  {
    href: "/docs/widget",
    label: "02",
    title: "Embed",
    blurb: "Hosted script, React, and widget options.",
  },
  {
    href: "/docs/self-hosting/docker",
    label: "03",
    title: "Self-host",
    blurb: "Docker, backups, and production ops.",
  },
] as const;

export default function HomePage() {
  return (
    <main className={`${display.variable} ${mono.variable} nz-docs-home`}>
      <section className="nz-docs-hero" aria-labelledby="nz-docs-hero-title">
        <div className="nz-docs-hero__grid" aria-hidden="true" />
        <div className="nz-docs-hero__glow" aria-hidden="true" />
        <div className="nz-docs-hero__frame" aria-hidden="true" />

        <div className="nz-docs-hero__inner">
          <p className="nz-docs-kicker">
            <span className="nz-docs-mark" aria-hidden="true">
              N0
            </span>
            <span>
              {brand.company.name} / {brand.product.projectNumber}
            </span>
          </p>

          <p className="nz-docs-eyebrow">Documentation</p>

          <h1 id="nz-docs-hero-title" className="nz-docs-brand">
            {brand.product.name}
          </h1>

          <p className="nz-docs-tagline">Your knowledge. Your AI. Anywhere.</p>

          <p className="nz-docs-lede">
            Install, self-host, embed the widget, and call the API — open-source AI assistants
            grounded in your knowledge.
          </p>

          <div className="nz-docs-actions">
            <Link href="/docs" className="nz-docs-btn nz-docs-btn--primary">
              Open documentation
            </Link>
            <a
              href={brand.product.appUrl}
              className="nz-docs-btn nz-docs-btn--ghost"
              target="_blank"
              rel="noreferrer"
            >
              Open ChatAI
            </a>
            <a
              href={GITHUB_REPO_URL}
              className="nz-docs-btn nz-docs-btn--ghost"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="nz-docs-paths" aria-label="Start here">
        <p className="nz-docs-paths__label">Start / 01—03</p>
        <ul className="nz-docs-paths__list">
          {paths.map((path) => (
            <li key={path.href}>
              <Link href={path.href} className="nz-docs-path">
                <span className="nz-docs-path__index">{path.label}</span>
                <span className="nz-docs-path__title">{path.title}</span>
                <span className="nz-docs-path__blurb">{path.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
