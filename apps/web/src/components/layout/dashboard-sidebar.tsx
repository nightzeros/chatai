"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { BrandLockup } from "@/components/brand/logo";
import { useAssistantWorkspace } from "@/components/layout/assistant-workspace-context";
import { NavItem } from "@/components/layout/nav-item";
import { NavSection } from "@/components/layout/nav-section";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONTRIBUTING_URL, GITHUB_REPO_URL } from "@/lib/site";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_NAV_GROUPS,
  isWorkspaceItemActive,
  workspaceHref,
} from "@/lib/workspace-nav";

function isAssistantsListPath(pathname: string) {
  return pathname === "/dashboard";
}

function assistantIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/assistants\/([^/]+)/);
  return match?.[1] ?? null;
}

const externalLinkClassName =
  "block rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground";

function WorkspaceNavNested({
  assistantId,
  pathname,
  onNavigate,
}: {
  assistantId: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="ml-2 space-y-2 border-l border-border pl-2" aria-label="Assistant pages">
      {WORKSPACE_NAV_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="mb-0.5 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {group.label}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const href = workspaceHref(assistantId, item.href);
              return (
                <li key={href}>
                  <NavItem
                    href={href}
                    nested
                    active={isWorkspaceItemActive(pathname, assistantId, item)}
                    onClick={onNavigate}
                  >
                    {item.label}
                  </NavItem>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AssistantSwitcherInline({
  currentId,
  assistants,
}: {
  currentId: string;
  assistants: { id: string; name: string }[];
}) {
  const router = useRouter();
  if (assistants.length <= 1) return null;

  return (
    <div className="px-1 pb-1">
      <Select
        value={currentId}
        onValueChange={(id) => {
          router.push(`/dashboard/assistants/${id}`);
        }}
      >
        <SelectTrigger className="h-8 w-full text-xs" aria-label="Switch assistant">
          <SelectValue placeholder="Switch assistant" />
        </SelectTrigger>
        <SelectContent>
          {assistants.map((a) => (
            <SelectItem key={a.id} value={a.id} className="text-xs">
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DashboardNavLinks({
  docsUrl,
  onNavigate,
  className,
}: {
  docsUrl: string;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { workspace } = useAssistantWorkspace();
  const pathAssistantId = assistantIdFromPath(pathname);
  const assistantId = workspace?.id ?? pathAssistantId;
  const inWorkspace = Boolean(assistantId);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        <NavSection label="Product">
          <li>
            <NavItem
              href="/dashboard"
              active={isAssistantsListPath(pathname)}
              onClick={onNavigate}
              className={inWorkspace && !isAssistantsListPath(pathname) ? "font-medium text-foreground" : undefined}
            >
              Assistants
            </NavItem>
            {inWorkspace && assistantId ? (
              <div className="mt-1.5 space-y-1.5">
                {workspace ? (
                  <p className="truncate px-2 text-xs font-medium text-foreground" title={workspace.name}>
                    {workspace.name}
                  </p>
                ) : null}
                {workspace ? (
                  <AssistantSwitcherInline currentId={workspace.id} assistants={workspace.siblings} />
                ) : null}
                <WorkspaceNavNested
                  assistantId={assistantId}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              </div>
            ) : null}
          </li>
        </NavSection>
        <NavSection label="Account">
          <li>
            <NavItem
              href="/dashboard/usage"
              active={pathname === "/dashboard/usage" || pathname.startsWith("/dashboard/usage/")}
              onClick={onNavigate}
            >
              Usage
            </NavItem>
          </li>
          <li>
            <NavItem
              href="/dashboard/billing"
              active={pathname === "/dashboard/billing" || pathname.startsWith("/dashboard/billing/")}
              onClick={onNavigate}
            >
              Billing
            </NavItem>
          </li>
          <li>
            <NavItem
              href="/dashboard/account"
              active={pathname === "/dashboard/account" || pathname.startsWith("/dashboard/account/")}
              onClick={onNavigate}
            >
              Account
            </NavItem>
          </li>
        </NavSection>
      </div>
      <div className="mt-auto shrink-0 border-t border-border px-3 py-3">
        <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Resources
        </p>
        <a
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          onClick={onNavigate}
          className={externalLinkClassName}
        >
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
      </div>
    </div>
  );
}

export function DashboardSidebar({ docsUrl }: { docsUrl: string }) {
  return (
    <aside className="hidden h-svh w-56 shrink-0 flex-col border-r border-border bg-muted/20 md:flex">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <BrandLockup href="/dashboard" markSize={24} showAttribution className="[&_span]:text-base" />
      </div>
      <DashboardNavLinks docsUrl={docsUrl} />
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
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex h-svh w-[min(100vw-3rem,18rem)] flex-col border-r border-border bg-card shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
              <BrandLockup href="/dashboard" markSize={22} className="min-w-0 [&_span]:text-sm" />
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Close navigation menu">
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
            <DashboardNavLinks docsUrl={docsUrl} onNavigate={() => setOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <BrandLockup href="/dashboard" markSize={22} className="min-w-0 truncate [&_span]:text-sm" />
    </div>
  );
}
