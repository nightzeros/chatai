"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

export function NavItem({
  href,
  active,
  children,
  onClick,
  className,
  nested = false,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  /** Slightly smaller / indented for nested workspace destinations. */
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "block rounded-md px-2 py-1.5 transition-colors",
        nested ? "py-1 text-[13px]" : "text-sm",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        className,
      )}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
