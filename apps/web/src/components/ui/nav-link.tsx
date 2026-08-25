"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export function NavLink({
  href,
  children,
  exact = false,
  match,
  className,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
  /** When set, overrides default prefix matching. */
  match?: (pathname: string) => boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = match
    ? match(pathname)
    : exact
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={cn(
        "rounded-md px-2 py-2 text-sm transition-colors",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        className,
      )}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
