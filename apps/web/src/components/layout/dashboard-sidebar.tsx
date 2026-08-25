import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { NavLink } from "@/components/ui/nav-link";
import { Separator } from "@/components/ui/separator";

export function DashboardSidebar({ email, docsUrl }: { email: string; docsUrl: string }) {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-border md:flex md:flex-col">
      <div className="flex h-14 items-center px-5">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          ChatAI
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        <NavLink
          href="/dashboard"
          match={(pathname) => pathname === "/dashboard" || pathname.startsWith("/dashboard/assistants")}
        >
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
        <Separator className="my-2" />
        <NavLink href="/dashboard/account">Account</NavLink>
      </nav>
      <div className="border-t border-border px-3 py-3">
        <p className="truncate px-2 text-xs text-muted-foreground">{email}</p>
      </div>
    </aside>
  );
}
