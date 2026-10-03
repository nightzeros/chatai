"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; exact?: boolean };

type NavGroup = { id: string; label: string | null; items: NavItem[] };

const groups: NavGroup[] = [
  {
    id: "home",
    label: null,
    items: [{ href: "", label: "Overview", exact: true }],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { href: "/knowledge", label: "Knowledge" },
      { href: "/profile", label: "Profile" },
      { href: "/playground", label: "Playground" },
    ],
  },
  {
    id: "monitor",
    label: "Monitor",
    items: [
      { href: "/conversations", label: "Conversations" },
      { href: "/analytics", label: "Analytics" },
      { href: "/evals", label: "Evaluations" },
    ],
  },
  {
    id: "deploy",
    label: "Deploy",
    items: [
      { href: "/customize", label: "Customize" },
      { href: "/install", label: "Install" },
    ],
  },
  {
    id: "configure",
    label: "Configure",
    items: [
      { href: "/settings", label: "General", exact: true },
      { href: "/settings/models", label: "Models" },
      { href: "/settings/security", label: "Security" },
      { href: "/settings/privacy", label: "Privacy" },
    ],
  },
];

function isActive(pathname: string, base: string, item: NavItem) {
  const href = `${base}${item.href}`;
  if (item.exact) {
    return pathname === href;
  }
  if (item.href === "/settings") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceNav({ assistantId }: { assistantId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/assistants/${assistantId}`;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    build: true,
    monitor: true,
    deploy: true,
    configure: true,
  });

  return (
    <nav className="space-y-3" aria-label="Assistant workspace">
      <div className="sticky top-0 z-10 -mx-[var(--spacing-page)] border-b border-border bg-background/95 px-[var(--spacing-page)] backdrop-blur-sm md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <div className="flex gap-1 overflow-x-auto pb-px [-ms-overflow-style:none] [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        {groups.flatMap((group) =>
          group.items.map((item) => {
            const href = `${base}${item.href}`;
            const active = isActive(pathname, base, item);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          }),
        )}
        </div>
      </div>

      <div className="hidden md:block">
        {groups.map((group) => {
          const expanded = group.label ? openGroups[group.id] !== false : true;
          return (
            <div key={group.id} className="mb-3">
              {group.label ? (
                <button
                  type="button"
                  className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setOpenGroups((prev) => ({ ...prev, [group.id]: !(prev[group.id] !== false) }))
                  }
                  aria-expanded={expanded}
                >
                  {group.label}
                  <ChevronDown className={cn("size-3.5 transition-transform", expanded ? "rotate-0" : "-rotate-90")} />
                </button>
              ) : null}
              {expanded ? (
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const href = `${base}${item.href}`;
                    const active = isActive(pathname, base, item);
                    return (
                      <li key={href}>
                        <Link
                          href={href}
                          className={cn(
                            "block rounded-md px-2 py-1.5 text-sm transition-colors",
                            active
                              ? "bg-accent font-medium text-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          )}
                          aria-current={active ? "page" : undefined}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
