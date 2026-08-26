import Link from "next/link";

import { BrandLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getDocsUrl } from "@/lib/docs-url";
import { brand, CONTRIBUTING_URL, GITHUB_REPO_URL } from "@/lib/site";

export function SiteHeader({ signedIn }: { signedIn?: boolean }) {
  const docsUrl = getDocsUrl();

  return (
    <header className="relative z-10 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[var(--content-max)] items-center justify-between gap-4 px-4 md:px-6">
        <BrandLockup />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={docsUrl} target="_blank" rel="noreferrer">
              Docs
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </Button>
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const docsUrl = getDocsUrl();

  return (
    <footer className="relative z-10 border-t border-border/60 bg-background/80">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="space-y-1">
          <p className="font-display text-sm font-semibold tracking-tight">ChatAI</p>
          <p className="text-xs text-muted-foreground">Open-source assistants on your knowledge.</p>
          <p className="text-xs text-muted-foreground">
            An open-source project by{" "}
            <a
              href={brand.company.url}
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:text-foreground hover:underline"
            >
              {brand.company.name}
            </a>
            .
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <a href={docsUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
            Documentation
          </a>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            GitHub
          </a>
          <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">
            Contribute
          </a>
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
