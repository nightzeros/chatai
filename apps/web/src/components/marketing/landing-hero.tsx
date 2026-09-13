"use client";

import Link from "next/link";

import { BrandMark } from "@/components/brand/logo";
import { ScrollZoom, TypewriterText } from "@/components/marketing/hero-motion";
import { ProductShowcase } from "@/components/marketing/product-showcase";
import { Button } from "@/components/ui/button";
import { GITHUB_REPO_URL } from "@/lib/site";

const TYPED_PHRASE = "on your knowledge";

export function LandingHero({
  signedIn,
  docsUrl,
}: {
  signedIn: boolean;
  docsUrl: string;
}) {
  return (
    <section className="mx-auto flex max-w-[var(--content-max)] flex-col gap-12 px-4 pb-16 pt-12 md:gap-16 md:px-6 md:pb-24 md:pt-16">
      <div className="reveal max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark size={40} />
          <span className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">ChatAI</span>
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl md:text-[2.75rem] md:leading-[1.1]">
          <span className="block sm:inline">Build AI assistants </span>
          <TypewriterText
            text={TYPED_PHRASE}
            className="text-foreground"
            startDelayMs={320}
            charMs={38}
          />
        </h1>
        <p className="reveal reveal-delay-1 mt-4 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
          Create an assistant, add documents and sites, test answers with citations, then embed a chat
          widget. Open source and self-hostable.
        </p>
        <div className="reveal reveal-delay-2 mt-8 flex flex-wrap items-center gap-3">
          {signedIn ? (
            <Button asChild size="lg">
              <Link href="/dashboard">Go to dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg">
                <Link href="/signup">Get started</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </>
          )}
          <Button asChild size="lg" variant="ghost">
            <a href={docsUrl} target="_blank" rel="noreferrer">
              Documentation
            </a>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </Button>
        </div>
      </div>

      <div className="reveal reveal-delay-3">
        <ScrollZoom minScale={0.9} maxScale={1.05}>
          <ProductShowcase />
        </ScrollZoom>
      </div>
    </section>
  );
}
