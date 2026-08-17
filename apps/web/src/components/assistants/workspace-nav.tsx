"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs = [
  { href: "", label: "Playground" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/conversations", label: "Conversations" },
  { href: "/analytics", label: "Analytics" },
  { href: "/customize", label: "Customize" },
  { href: "/install", label: "Install" },
  { href: "/settings", label: "Settings" },
] as const;

export function WorkspaceNav({ assistantId }: { assistantId: string }) {
  const pathname = usePathname();
  const base = `/dashboard/assistants/${assistantId}`;

  return (
    <nav className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const href = `${base}${tab.href}`;
        const active = tab.href === "" ? pathname === base : pathname.startsWith(href);

        return (
          <Link
            key={tab.label}
            href={href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
