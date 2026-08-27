"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { BookOpen, Github, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BrandLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { brand, CONTRIBUTING_URL, GITHUB_REPO_URL } from "@/lib/site";

export function SiteHeader({ signedIn, docsUrl }: { signedIn?: boolean; docsUrl: string }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-10 border-b border-border/60 bg-background/70 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[var(--content-max)] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4 md:px-6">
        <BrandLockup className="min-w-0 shrink" />

        <nav className="hidden items-center gap-1 sm:flex sm:gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href={docsUrl} target="_blank" rel="noreferrer">
              Docs
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
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

        <div className="flex items-center gap-1 sm:hidden">
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Open menu">
                <Menu className="size-4" />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
              <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(100vw-3rem,18rem)] flex-col border-l border-border bg-card shadow-lg outline-none">
                <div className="flex h-14 items-center justify-between border-b border-border px-4">
                  <span className="text-sm font-medium">Menu</span>
                  <Dialog.Close asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Close menu">
                      <X className="size-4" />
                    </Button>
                  </Dialog.Close>
                </div>
                <nav className="flex flex-col gap-1 p-3">
                  <a
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <BookOpen className="size-4" />
                    Documentation
                  </a>
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  >
                    <Github className="size-4" />
                    GitHub
                  </a>
                  {!signedIn ? (
                    <Link
                      href="/signup"
                      onClick={() => setOpen(false)}
                      className="mt-2 rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground"
                    >
                      Get started
                    </Link>
                  ) : null}
                </nav>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({ docsUrl }: { docsUrl: string }) {
  return (
    <footer className="relative z-10 border-t border-border/60 bg-background/80">
      <div className="mx-auto flex max-w-[var(--content-max)] flex-col gap-4 px-[var(--spacing-page)] py-8 md:flex-row md:items-center md:justify-between md:px-6">
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
