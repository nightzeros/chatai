"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { useState } from "react";

import { BrandLockup } from "@/components/brand/logo";
import { NavLink } from "@/components/ui/nav-link";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { CONTRIBUTING_URL, GITHUB_REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

function isAssistantsPath(pathname: string) {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/assistants");
}

const externalLinkClassName =
  "rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground";

function DashboardNavLinks({
  docsUrl,
  onNavigate,
  className,
}: {
  docsUrl: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav className={cn("flex flex-col gap-1", className)}>
      <NavLink href="/dashboard" match={isAssistantsPath} onClick={onNavigate}>
        Assistants
      </NavLink>
      <a href={docsUrl} target="_blank" rel="noreferrer" onClick={onNavigate} className={externalLinkClassName}>
        Documentation
      </a>
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
        className={externalLinkClassName}
      >
        GitHub
      </a>
      <a
        href={CONTRIBUTING_URL}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
        className={externalLinkClassName}
      >
        Contribute
      </a>
      <Separator className="my-2" />
      <NavLink href="/dashboard/usage" onClick={onNavigate}>
        Usage
      </NavLink>
      <NavLink href="/dashboard/account" onClick={onNavigate}>
        Account
      </NavLink>
    </nav>
  );
}

export function DashboardSidebar({ docsUrl }: { docsUrl: string }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-card/40 md:flex md:flex-col">
      <div className="flex h-14 items-center px-4">
        <BrandLockup href="/dashboard" markSize={24} showAttribution className="[&_span]:text-base" />
      </div>
      <DashboardNavLinks docsUrl={docsUrl} className="flex-1 px-3 py-2" />
    </aside>
  );
}

export function DashboardMobileNav({ docsUrl }: { docsUrl: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label="Open navigation menu">
            <Menu className="size-4" />
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(100vw-3rem,18rem)] flex-col border-r border-border bg-card shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <BrandLockup href="/dashboard" markSize={22} className="min-w-0 [&_span]:text-sm" />
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Close navigation menu">
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
            <DashboardNavLinks docsUrl={docsUrl} onNavigate={() => setOpen(false)} className="flex-1 overflow-y-auto p-3" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <BrandLockup href="/dashboard" markSize={22} className="min-w-0 truncate [&_span]:text-sm" />
    </div>
  );
}
