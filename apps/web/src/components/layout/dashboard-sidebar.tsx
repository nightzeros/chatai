"use client";

import { BrandLockup } from "@/components/brand/logo";
import { NavLink } from "@/components/ui/nav-link";
import { Separator } from "@/components/ui/separator";
import { CONTRIBUTING_URL, GITHUB_REPO_URL } from "@/lib/site";

function isAssistantsPath(pathname: string) {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/assistants");
}

export function DashboardSidebar({ docsUrl }: { docsUrl: string }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-card/40 md:flex md:flex-col">
      <div className="flex h-14 items-center px-4">
        <BrandLockup href="/dashboard" markSize={24} className="[&_span]:text-base" />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        <NavLink href="/dashboard" match={isAssistantsPath}>
          Assistants
        </NavLink>
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          Documentation
        </a>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          GitHub
        </a>
        <a
          href={CONTRIBUTING_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          Contribute
        </a>
        <Separator className="my-2" />
        <NavLink href="/dashboard/account">Account</NavLink>
      </nav>
    </aside>
  );
}

export function DashboardMobileNav({ docsUrl }: { docsUrl: string }) {
  return (
    <nav className="flex max-w-[calc(100vw-8rem)] items-center gap-1 overflow-x-auto md:hidden">
      <BrandLockup href="/dashboard" markSize={22} className="mr-1 shrink-0 [&_span]:text-sm" />
      <NavLink href="/dashboard" className="shrink-0 px-1.5 py-1" match={isAssistantsPath}>
        Assistants
      </NavLink>
      <a
        href={docsUrl}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground"
      >
        Docs
      </a>
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        className="shrink-0 rounded-md px-1.5 py-1 text-sm text-muted-foreground"
      >
        GitHub
      </a>
      <NavLink href="/dashboard/account" className="shrink-0 px-1.5 py-1">
        Account
      </NavLink>
    </nav>
  );
}
